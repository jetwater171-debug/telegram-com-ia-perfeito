import { randomUUID } from 'node:crypto';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { getPaymentStatusMultiGateway, normalizePaymentGatewayId } from '@/lib/paymentGatewayService';
import { markLeadPaid } from '@/lib/leadScoring';
import { sendTelegramMessageStrict } from '@/lib/telegram';
import {
  collectPaymentReferenceCandidates,
  findPaymentStatus,
  isPaymentPaidPayload,
  paymentReferenceSetsIntersect,
} from '@/lib/paymentStatus';
import { appendLeadEventSafe, claimLeadEventSafe, patchRealityStateSafe, reserveLeadEventClaimSafe } from '@/lib/brain/eventStore';
import { trackPaymentOutcomeSafe } from '@/lib/brain/outcomeTracker';
import { recordPreviewPurchaseSafe } from '@/lib/brain/previewBandit';
import { markCustomOrderPaidSafe, markSessionSalesOrderPaidSafe, recordCustomOrderSafe } from '@/lib/customOrders';
import {
  getCommercialFulfillmentBrief,
  getCommercialOffer,
  getCommercialPaymentConfirmationMessage,
  type CommercialSku,
} from '@/lib/commercialCatalog';

type PaymentMessage = {
  id: string;
  session_id: string;
  content?: string | null;
  payment_data?: Record<string, any> | null;
  created_at?: string | null;
};

type ReconcileOptions = {
  gateway?: string;
  notify?: boolean;
  botToken?: string;
  telegramChatId?: string;
  source?: string;
  statusPayload?: any;
};

const canonicalPaymentQuery = () => supabase
  .from('messages')
  .select('id,session_id,content,payment_data,created_at')
  .eq('sender', 'system')
  .ilike('content', '%PIX GENERATED%')
  .not('payment_data', 'is', null);

const throwOnError = (error: any, operation: string) => {
  if (error) throw new Error(`${operation}: ${error.message || error}`);
};

const paymentLedgerKey = (paymentData: any, index: number) => String(
  paymentData?.paymentId || paymentData?.idempotency_key || paymentData?.transactionId || `row:${index}`,
).trim().toLowerCase();

export const inspectCommercialPaymentIntegrity = (paymentData: Record<string, any> = {}) => {
  const value = Number(paymentData.value || 0);
  const amountCents = Number(paymentData.amount_cents || Math.round(value * 100));
  const product = String(paymentData.product || 'produto');
  const description = String(paymentData.description || product);
  const commercialOffer = getCommercialOffer(paymentData.sku as CommercialSku);
  const fixedCommercialProduct = product === 'vip' || product === 'video_call';
  const catalogMismatch = Boolean(
    (commercialOffer && (
      commercialOffer.product !== product
      || commercialOffer.amountCents !== amountCents
      || Math.round(commercialOffer.value * 100) !== Math.round(value * 100)
    ))
    || (fixedCommercialProduct && !commercialOffer),
  );
  return { value, amountCents, product, description, commercialOffer, catalogMismatch };
};

export const calculatePaidLedgerTotal = (rows: Array<{ payment_data?: any }>) => {
  const seen = new Set<string>();
  let totalInCents = 0;
  rows.forEach((row, index) => {
    const data = row?.payment_data || {};
    if (!(data.paid === true || isPaymentPaidPayload(data))) return;
    const key = paymentLedgerKey(data, index);
    if (seen.has(key)) return;
    seen.add(key);
    const value = Number(data.value || 0);
    if (Number.isFinite(value) && value > 0) totalInCents += Math.round(value * 100);
  });
  return totalInCents / 100;
};

const syncSessionPaymentLedger = async (sessionId: string) => {
  const [{ data: paymentRows, error: paymentError }, { data: session, error: sessionError }] = await Promise.all([
    canonicalPaymentQuery().eq('session_id', sessionId).limit(1000),
    supabase.from('sessions').select('id,total_paid,lead_score,telegram_chat_id').eq('id', sessionId).maybeSingle(),
  ]);
  throwOnError(paymentError, 'payment_ledger_read');
  throwOnError(sessionError, 'payment_session_read');
  if (!session?.id) throw new Error('payment_session_not_found');

  const totalPaid = calculatePaidLedgerTotal(paymentRows || []);
  const update = await supabase.from('sessions').update({
    total_paid: totalPaid,
    lead_score: totalPaid > 0 ? markLeadPaid(session.lead_score) : session.lead_score,
  }).eq('id', sessionId);
  throwOnError(update.error, 'payment_session_update');
  return { totalPaid, session };
};

const loadBotToken = async () => {
  const { data } = await supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').maybeSingle();
  return String(data?.value || process.env.TELEGRAM_BOT_TOKEN || '').trim();
};

export const reconcilePaymentMessage = async (paymentMessage: PaymentMessage, options: ReconcileOptions = {}) => {
  const { data: freshMessage, error: freshError } = await supabase
    .from('messages')
    .select('id,session_id,content,payment_data,created_at')
    .eq('id', paymentMessage.id)
    .maybeSingle();
  throwOnError(freshError, 'payment_message_refresh');
  if (!freshMessage?.id) throw new Error('payment_message_not_found');

  const paymentData = freshMessage.payment_data || {};
  const gateway = normalizePaymentGatewayId(options.gateway || paymentData.gateway) || 'wiinpay';
  const statusPayload = options.statusPayload ?? paymentData;
  const paid = paymentData.paid === true || isPaymentPaidPayload(statusPayload);
  const status = findPaymentStatus(statusPayload) || findPaymentStatus(paymentData) || (paid ? 'paid' : 'pending');
  const wasCounted = paymentData.counted === true;
  const checkedAt = new Date().toISOString();
  const {
    value,
    amountCents,
    product,
    description,
    commercialOffer,
    catalogMismatch: commercialCatalogMismatch,
  } = inspectCommercialPaymentIntegrity(paymentData);
  const awaitingManualFulfillment = Boolean(commercialOffer)
    || ['custom_photo', 'custom_video', 'custom_request', 'erotic_audio', 'evaluation', 'social_meetup'].includes(product);
  const requiresManualOrder = awaitingManualFulfillment || commercialCatalogMismatch;
  const mismatchBrief = commercialCatalogMismatch
    ? `REVISAO MANUAL OBRIGATORIA: SKU, produto ou valor incompatível. Recebido ${String(paymentData.sku || 'sem_sku')} / ${product} / ${amountCents} centavos.`
    : null;
  const paymentId = String(paymentData.paymentId || '').trim();
  const fulfillmentOrderRecorded = paid && requiresManualOrder
    ? (paymentId ? await recordCustomOrderSafe({
      sessionId: String(freshMessage.session_id),
      paymentId,
      gateway,
      requestBrief: mismatchBrief
        || (commercialOffer ? getCommercialFulfillmentBrief(commercialOffer.sku) : String(paymentData.custom_request_brief || description)),
      amount: value,
      product,
      orderId: String(paymentData.order_id || ''),
      paymentData: {
        ...paymentData,
        catalog_integrity: commercialCatalogMismatch ? 'mismatch' : 'valid',
      },
    }) : false)
    : true;
  const confirmedAt = paymentData.paid_at || checkedAt;
  const fulfillmentOrderMarkedPaid = paid && requiresManualOrder
    ? (fulfillmentOrderRecorded && paymentId
      ? await markCustomOrderPaidSafe(
        paymentId,
        confirmedAt,
        commercialCatalogMismatch ? 'paid_needs_manual_review' : 'paid',
      )
      : false)
    : true;
  const fulfillmentReady = fulfillmentOrderRecorded && fulfillmentOrderMarkedPaid;
  if (paid) {
    await markSessionSalesOrderPaidSafe({
      sessionId: String(freshMessage.session_id),
      orderId: String(paymentData.order_id || ''),
      paymentId,
      paidAt: confirmedAt,
      status: commercialCatalogMismatch ? 'paid_needs_manual_review' : 'paid',
    });
  }

  const nextPaymentData = {
    ...paymentData,
    gateway,
    paid: paid || paymentData.paid === true,
    counted: paid ? true : wasCounted,
    status,
    paid_at: paid ? (paymentData.paid_at || checkedAt) : paymentData.paid_at,
    fulfillment_status: paid
      ? (!fulfillmentReady
        ? 'fulfillment_write_failed'
        : commercialCatalogMismatch
          ? 'paid_needs_manual_review'
          : product === 'social_meetup'
        ? 'paid_awaiting_scheduling'
        : awaitingManualFulfillment
          ? 'paid_awaiting_fulfillment'
          : 'paid')
      : paymentData.fulfillment_status,
    catalog_integrity: commercialCatalogMismatch ? 'mismatch' : (commercialOffer ? 'valid' : paymentData.catalog_integrity),
    last_checked_at: checkedAt,
    last_check_error: statusPayload?.ok === false ? String(statusPayload?.error || 'payment_status_error').slice(0, 500) : null,
    last_status_payload: statusPayload,
    ...(options.source?.includes('webhook') ? { last_webhook_at: checkedAt } : {}),
  };

  const messageUpdate = await supabase.from('messages').update({ payment_data: nextPaymentData }).eq('id', freshMessage.id);
  throwOnError(messageUpdate.error, 'payment_message_update');

  if (!paid) {
    return { paymentId: paymentData.paymentId || '', paid: false, counted: false, status, gateway, totalPaid: null };
  }

  const { totalPaid, session } = await syncSessionPaymentLedger(freshMessage.session_id);
  const ledgerSyncedAt = new Date().toISOString();
  const ledgerUpdate = await supabase.from('messages').update({
    payment_data: { ...nextPaymentData, counted: true, ledger_synced_at: ledgerSyncedAt },
  }).eq('id', freshMessage.id);
  throwOnError(ledgerUpdate.error, 'payment_ledger_marker_update');

  const confirmationDispatchState = String(paymentData.confirmation_dispatch_state || '');
  const notificationWasReserved = confirmationDispatchState === 'notification_reserved';
  const confirmationClaimToken = randomUUID();
  const confirmationSourceId = String(paymentData.paymentId || freshMessage.id);
  // Antes de reservar o envio externo, um worker interrompido pode ser
  // retomado após o lease. Depois da reserva, não há reenvio automático:
  // Telegram não oferece chave de idempotência e uma queda durante o request é
  // ambígua. Esse caso fica visível para revisão sem duplicar a mensagem.
  const confirmationClaim = !paymentData.confirmation_completed_at && !notificationWasReserved
    ? await claimLeadEventSafe({
      sessionId: String(freshMessage.session_id),
      eventType: 'payment_confirmation_claimed',
      source: 'payment_reconciliation',
      sourceId: confirmationSourceId,
      payload: {
        message_id: freshMessage.id,
        gateway,
        checked_at: checkedAt,
        claim_token: confirmationClaimToken,
        phase: 'processing',
      },
      staleAfterMs: 5 * 60_000,
    })
    : 'duplicate';
  if (confirmationClaim === 'unavailable') {
    throw new Error('payment_confirmation_claim_unavailable');
  }
  if (confirmationClaim === 'reserved' && !notificationWasReserved) {
    const reservedRecoveryUpdate = await supabase.from('messages').update({
      payment_data: {
        ...nextPaymentData,
        counted: true,
        ledger_synced_at: ledgerSyncedAt,
        confirmation_dispatch_state: 'notification_reserved',
        confirmation_notification_reserved_at: paymentData.confirmation_notification_reserved_at || checkedAt,
        confirmation_manual_review_reason: 'reserved_claim_without_completion',
      },
    }).eq('id', freshMessage.id);
    throwOnError(reservedRecoveryUpdate.error, 'payment_confirmation_reserved_recovery');
  }
  const freshlyConfirmed = !paymentData.confirmation_completed_at
    && !notificationWasReserved
    && confirmationClaim === 'claimed';
  if (freshlyConfirmed) {
    const processingUpdate = await supabase.from('messages').update({
      payment_data: {
        ...nextPaymentData,
        counted: true,
        ledger_synced_at: ledgerSyncedAt,
        confirmation_dispatch_state: 'processing',
        confirmation_claimed_at: checkedAt,
        confirmation_claim_token: confirmationClaimToken,
      },
    }).eq('id', freshMessage.id);
    throwOnError(processingUpdate.error, 'payment_confirmation_processing_marker');

    const isSocialMeetup = product === 'social_meetup';
    await supabase.from('messages').insert({
      session_id: freshMessage.session_id,
      sender: 'system',
      content: `[SISTEMA: PAGAMENTO CONFIRMADO - ${description} - R$ ${value}. TOTAL PAGO: R$ ${totalPaid}]`,
    });
    await supabase.from('funnel_events').insert({
      session_id: freshMessage.session_id,
      step: 'PAYMENT_CONFIRMED',
      source: options.source || `${gateway}_reconciliation`,
    });
    const paymentOutcomeEventId = await appendLeadEventSafe({
      sessionId: String(freshMessage.session_id),
      eventType: 'payment_confirmed',
      source: options.source || `${gateway}_reconciliation`,
      sourceId: String(paymentData.paymentId || freshMessage.id),
      payload: {
        order_id: paymentData.order_id || null,
        payment_id: paymentData.paymentId || null,
        gateway,
        product,
        sku: paymentData.sku || null,
        description,
        amount: value,
        amount_cents: amountCents,
        total_confirmed: totalPaid,
        catalog_integrity: commercialCatalogMismatch ? 'mismatch' : 'valid',
      },
      occurredAt: confirmedAt,
    });
    const paymentOutcome = await trackPaymentOutcomeSafe({
      sessionId: String(freshMessage.session_id),
      eventId: paymentOutcomeEventId,
      amount: value,
      product,
    });
    if (paymentOutcome.previewId) await recordPreviewPurchaseSafe(paymentOutcome.previewId);
    await patchRealityStateSafe(String(freshMessage.session_id), {
      payment: {
        totalConfirmed: totalPaid,
        lastConfirmedValue: value,
        lastConfirmedProduct: product,
        pendingPaymentId: null,
      },
      commercial: {
        currentOrder: paymentData.order_id ? {
          orderId: paymentData.order_id,
          product,
          sku: commercialCatalogMismatch ? null : (paymentData.sku || null),
          amount: value,
          amountCents,
          description,
          status: commercialCatalogMismatch ? 'paid_needs_manual_review' : 'paid',
          paymentId: paymentData.paymentId || null,
          paidAt: confirmedAt,
        } : null,
        lastProductBought: product,
        lastSkuBought: commercialCatalogMismatch ? null : (paymentData.sku || null),
        lastPurchaseAt: confirmedAt,
        postPurchaseCooldownUntil: new Date(Date.parse(confirmedAt) + 24 * 60 * 60_000).toISOString(),
      },
    });

    let notificationReservedAt: string | null = null;
    if (options.notify !== false) {
      const telegramChatId = String(options.telegramChatId || session.telegram_chat_id || '').trim();
      const botToken = String(options.botToken || await loadBotToken()).trim();
      if (!telegramChatId) throw new Error('payment_confirmation_chat_id_missing');
      if (!botToken) throw new Error('payment_confirmation_bot_token_missing');

      const eventReservation = await reserveLeadEventClaimSafe({
        sessionId: String(freshMessage.session_id),
        eventType: 'payment_confirmation_claimed',
        sourceId: confirmationSourceId,
        claimToken: confirmationClaimToken,
        payload: { message_id: freshMessage.id, gateway },
      });
      if (eventReservation === 'unavailable') throw new Error('payment_confirmation_reservation_unavailable');
      if (eventReservation !== 'reserved') throw new Error('payment_confirmation_claim_lost_before_notification');

      notificationReservedAt = new Date().toISOString();
      const reservationUpdate = await supabase.from('messages').update({
        payment_data: {
          ...nextPaymentData,
          counted: true,
          ledger_synced_at: ledgerSyncedAt,
          confirmation_dispatch_state: 'notification_reserved',
          confirmation_claimed_at: checkedAt,
          confirmation_claim_token: confirmationClaimToken,
          confirmation_notification_reserved_at: notificationReservedAt,
        },
      }).eq('id', freshMessage.id);
      throwOnError(reservationUpdate.error, 'payment_confirmation_notification_reservation');
      await sendTelegramMessageStrict(
        botToken,
        telegramChatId,
        (!fulfillmentReady
          ? 'pagamento confirmado! tive uma falha ao registrar a entrega e ja deixei sinalizado para conferencia manual'
          : commercialCatalogMismatch
          ? 'pagamento confirmado! vou conferir seu pacote manualmente antes da liberacao e te aviso por aqui'
          : getCommercialPaymentConfirmationMessage(paymentData.sku as CommercialSku))
        || (isSocialMeetup
          ? 'pagamento confirmado, agora vamos alinhar e confirmar os detalhes do nosso encontro'
          : product === 'erotic_audio'
            ? 'confirmado amor... agora me fala como quer o áudio e o nome que eu faço pra vc'
          : 'confirmado! seu pedido entrou na fila de entrega e eu te aviso por aqui'),
      );
    }
    const confirmationCompletedAt = new Date().toISOString();
    const completionUpdate = await supabase.from('messages').update({
      payment_data: {
        ...nextPaymentData,
        counted: true,
        ledger_synced_at: ledgerSyncedAt,
        confirmation_completed_at: confirmationCompletedAt,
        confirmation_dispatch_state: 'completed',
        confirmation_claimed_at: checkedAt,
        confirmation_claim_token: confirmationClaimToken,
        ...(notificationReservedAt ? { confirmation_notification_reserved_at: notificationReservedAt } : {}),
      },
    }).eq('id', freshMessage.id);
    throwOnError(completionUpdate.error, 'payment_confirmation_marker_update');
  }

  return {
    paymentId: paymentData.paymentId || '',
    paid: true,
    counted: true,
    freshlyConfirmed,
    status,
    gateway,
    totalPaid,
    catalogMismatch: commercialCatalogMismatch,
    fulfillmentOrderRecorded,
    fulfillmentReady,
  };
};

export const findPaymentMessageForWebhook = async (payload: any, gateway?: string): Promise<PaymentMessage | null> => {
  const references = collectPaymentReferenceCandidates(payload);
  if (!references.length) return null;

  const { data, error } = await canonicalPaymentQuery()
    .order('created_at', { ascending: false })
    .limit(250);
  throwOnError(error, 'payment_webhook_lookup');
  const normalizedGateway = normalizePaymentGatewayId(gateway);

  return ((data || []) as PaymentMessage[]).find((row) => {
    const paymentData = row.payment_data || {};
    const storedGateway = normalizePaymentGatewayId(paymentData.gateway);
    if (normalizedGateway && storedGateway && normalizedGateway !== storedGateway) return false;
    const storedReferences = collectPaymentReferenceCandidates(paymentData);
    const contentReference = String(row.content || '').match(/\bID:\s*([a-zA-Z0-9_-]+)/)?.[1];
    if (contentReference) storedReferences.push(contentReference);
    return paymentReferenceSetsIntersect(references, storedReferences);
  }) || null;
};

export const reconcilePendingPayments = async ({
  sessionId,
  limit = 12,
  minCheckIntervalMs = 20_000,
  notify = true,
}: {
  sessionId?: string;
  limit?: number;
  minCheckIntervalMs?: number;
  notify?: boolean;
} = {}) => {
  let query = canonicalPaymentQuery().order('created_at', { ascending: false }).limit(Math.max(limit * 8, 80));
  if (sessionId) query = query.eq('session_id', sessionId);
  const { data, error } = await query;
  throwOnError(error, 'pending_payments_read');

  const rows = (data || []) as PaymentMessage[];
  const results: any[] = [];
  for (const row of rows) {
    if (results.length >= limit) break;
    const paymentData = row.payment_data || {};
    if (!paymentData.paymentId || !paymentData.gateway) continue;

    const storedPaid = paymentData.paid === true || isPaymentPaidPayload(paymentData);
    const ledgerNeedsRepair = storedPaid && !paymentData.ledger_synced_at;
    const confirmationNeedsRepair = storedPaid
      && !paymentData.confirmation_completed_at
      && String(paymentData.confirmation_dispatch_state || '') !== 'notification_reserved';
    const fulfillmentNeedsRepair = storedPaid && paymentData.fulfillment_status === 'fulfillment_write_failed';
    const lastCheckedMs = Date.parse(String(paymentData.last_checked_at || ''));
    const checkIsDue = !Number.isFinite(lastCheckedMs) || Date.now() - lastCheckedMs >= minCheckIntervalMs;
    if (!ledgerNeedsRepair && !confirmationNeedsRepair && !fulfillmentNeedsRepair && (storedPaid || !checkIsDue)) continue;

    try {
      const statusPayload = storedPaid
        ? paymentData
        : await getPaymentStatusMultiGateway(String(paymentData.paymentId), String(paymentData.gateway));
      results.push(await reconcilePaymentMessage(row, {
        gateway: paymentData.gateway,
        notify,
        source: `${paymentData.gateway}_poll`,
        statusPayload,
      }));
    } catch (paymentError: any) {
      results.push({
        paymentId: paymentData.paymentId,
        paid: false,
        error: String(paymentError?.message || paymentError),
      });
    }
  }

  const paid = results.filter((result) => result.paid).length;
  const freshlyConfirmed = results.filter((result) => result.freshlyConfirmed).length;
  const confirmationManualReview = rows.filter((row) => {
    const data = row.payment_data || {};
    return (data.paid === true || isPaymentPaidPayload(data))
      && !data.confirmation_completed_at
      && String(data.confirmation_dispatch_state || '') === 'notification_reserved';
  }).length;
  const latestSessionTotal = [...results].reverse().find((result) => Number.isFinite(result.totalPaid))?.totalPaid ?? null;
  return { checked: results.length, paid, freshlyConfirmed, confirmationManualReview, latestSessionTotal, results };
};
