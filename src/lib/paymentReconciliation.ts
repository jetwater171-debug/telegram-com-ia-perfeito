import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { getPaymentStatusMultiGateway, normalizePaymentGatewayId } from '@/lib/paymentGatewayService';
import { markLeadPaid } from '@/lib/leadScoring';
import { sendTelegramMessage } from '@/lib/telegram';
import {
  collectPaymentReferenceCandidates,
  findPaymentStatus,
  isPaymentPaidPayload,
  paymentReferenceSetsIntersect,
} from '@/lib/paymentStatus';
import { appendLeadEventSafe, patchRealityStateSafe } from '@/lib/brain/eventStore';
import { trackPaymentOutcomeSafe } from '@/lib/brain/outcomeTracker';
import { recordPreviewPurchaseSafe } from '@/lib/brain/previewBandit';
import { markCustomOrderPaidSafe } from '@/lib/customOrders';

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

  const nextPaymentData = {
    ...paymentData,
    gateway,
    paid: paid || paymentData.paid === true,
    counted: paid ? true : wasCounted,
    status,
    paid_at: paid ? (paymentData.paid_at || checkedAt) : paymentData.paid_at,
    fulfillment_status: paid
      ? (String(paymentData.product || '') === 'social_meetup'
        ? 'paid_awaiting_scheduling'
        : paymentData.fulfillment_status || 'paid')
      : paymentData.fulfillment_status,
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

  const freshlyConfirmed = !wasCounted;
  if (freshlyConfirmed) {
    const value = Number(paymentData.value || 0);
    const product = String(paymentData.product || 'produto');
    const description = String(paymentData.description || product);
    const isSocialMeetup = product === 'social_meetup';
    if (product === 'custom_request') {
      await markCustomOrderPaidSafe(String(paymentData.paymentId || ''), nextPaymentData.paid_at || checkedAt);
    }
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
        payment_id: paymentData.paymentId || null,
        gateway,
        product,
        description,
        amount: value,
        total_confirmed: totalPaid,
      },
      occurredAt: nextPaymentData.paid_at || checkedAt,
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
        pendingPaymentId: null,
      },
      commercial: {
        lastProductBought: product,
        lastPurchaseAt: nextPaymentData.paid_at || checkedAt,
        postPurchaseCooldownUntil: new Date(Date.parse(nextPaymentData.paid_at || checkedAt) + 24 * 60 * 60_000).toISOString(),
      },
    });

    if (options.notify !== false && session.telegram_chat_id) {
      const botToken = await loadBotToken();
      if (botToken) {
        await sendTelegramMessage(
          botToken,
          session.telegram_chat_id,
          isSocialMeetup
            ? 'pagamento confirmado, agora vamos alinhar e confirmar os detalhes do nosso encontro'
            : 'confirmado amor! obrigada... vou te mandar agora',
        );
      }
    }
  }

  return {
    paymentId: paymentData.paymentId || '',
    paid: true,
    counted: true,
    freshlyConfirmed,
    status,
    gateway,
    totalPaid,
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
    const lastCheckedMs = Date.parse(String(paymentData.last_checked_at || ''));
    const checkIsDue = !Number.isFinite(lastCheckedMs) || Date.now() - lastCheckedMs >= minCheckIntervalMs;
    if (!ledgerNeedsRepair && (storedPaid || !checkIsDue)) continue;

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
  const latestSessionTotal = [...results].reverse().find((result) => Number.isFinite(result.totalPaid))?.totalPaid ?? null;
  return { checked: results.length, paid, freshlyConfirmed, latestSessionTotal, results };
};
