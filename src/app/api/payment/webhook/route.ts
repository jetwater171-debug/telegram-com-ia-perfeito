import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendTelegramMessage } from '@/lib/telegram';
import { normalizePaymentGatewayId } from '@/lib/paymentGatewayService';

const PAID_STATUS = new Set(['paid', 'approved', 'completed', 'confirmed', 'success', 'aprovado', 'pago', 'concluido', 'liquidado']);

const normalizeStatus = (value: any) => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

const pickText = (...values: any[]) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const findTransactionId = (payload: any) => pickText(
  payload?.id,
  payload?.transaction_id,
  payload?.transactionId,
  payload?.payment_id,
  payload?.paymentId,
  payload?.data?.id,
  payload?.data?.transaction_id,
  payload?.data?.transactionId,
  payload?.transaction?.id,
  payload?.data?.transaction?.id
);

const findStatus = (payload: any) => normalizeStatus(pickText(
  payload?.status,
  payload?.payment_status,
  payload?.paymentStatus,
  payload?.data?.status,
  payload?.data?.payment_status,
  payload?.transaction?.status,
  payload?.data?.transaction?.status
));

const isPaidPayload = (payload: any) => {
  if (payload?.paid === true || payload?.data?.paid === true || payload?.payment?.paid === true || payload?.data?.payment?.paid === true) return true;
  if (payload?.paid_at || payload?.approved_at || payload?.data?.paid_at || payload?.data?.approved_at) return true;
  return PAID_STATUS.has(findStatus(payload));
};

const loadSetting = async (key: string) => {
  const { data } = await supabase.from('bot_settings').select('value').eq('key', key).maybeSingle();
  return String(data?.value || process.env[key.toUpperCase()] || '').trim();
};

const validateWebhookToken = async (req: NextRequest) => {
  const expected = await loadSetting('payment_webhook_token');
  if (!expected) return true;
  const received = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token') || req.headers.get('x-pushinpay-token') || '';
  return received === expected;
};

async function POST(req: NextRequest) {
  try {
    if (!(await validateWebhookToken(req))) {
      return NextResponse.json({ error: 'invalid_webhook_token' }, { status: 401 });
    }

    const gateway = normalizePaymentGatewayId(req.nextUrl.searchParams.get('gateway')) || 'pushinpay';
    const payload = await req.json().catch(() => ({}));
    const transactionId = findTransactionId(payload);
    const status = findStatus(payload) || 'unknown';
    const paid = isPaidPayload(payload);

    if (!transactionId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'missing_transaction_id' });
    }

    const { data: paymentRows } = await supabase
      .from('messages')
      .select('id, session_id, payment_data')
      .eq('sender', 'system')
      .filter('payment_data->>paymentId', 'eq', transactionId)
      .order('created_at', { ascending: false })
      .limit(1);

    const paymentMsg = paymentRows?.[0];
    if (!paymentMsg?.id) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'payment_not_found', transactionId, status });
    }

    const { data: session } = await supabase
      .from('sessions')
      .select('id, telegram_chat_id, total_paid')
      .eq('id', paymentMsg.session_id)
      .maybeSingle();

    const paymentData = paymentMsg.payment_data || {};
    const value = Number(paymentData.value || 0);
    const alreadyCounted = paymentData.counted === true;
    const shouldCount = paid && !alreadyCounted;
    const newTotal = shouldCount ? Number(session?.total_paid || 0) + value : Number(session?.total_paid || 0);

    await supabase.from('messages').update({
      payment_data: {
        ...paymentData,
        gateway,
        paid: paid || paymentData.paid === true,
        counted: paid ? true : alreadyCounted,
        status,
        paid_at: paid ? (paymentData.paid_at || new Date().toISOString()) : paymentData.paid_at,
        last_checked_at: new Date().toISOString(),
        last_webhook_payload: payload,
      },
    }).eq('id', paymentMsg.id);

    if (shouldCount && session?.id) {
      await supabase.from('sessions').update({ total_paid: newTotal }).eq('id', session.id);
      await supabase.from('messages').insert({
        session_id: session.id,
        sender: 'system',
        content: `[SISTEMA: PAGAMENTO CONFIRMADO VIA WEBHOOK - R$ ${value}. TOTAL PAGO: R$ ${newTotal}]`,
      });
      await supabase.from('funnel_events').insert({
        session_id: session.id,
        step: 'PAYMENT_CONFIRMED',
        source: `${gateway}_webhook`,
      });

      const botToken = await loadSetting('telegram_bot_token');
      if (botToken && session.telegram_chat_id) {
        await sendTelegramMessage(botToken, session.telegram_chat_id, 'confirmado amor! obrigada... vou te mandar agora');
      }
    }

    return NextResponse.json({ ok: true, transactionId, status, paid });
  } catch (error: any) {
    console.error('Payment webhook error:', error);
    return NextResponse.json({ error: error?.message || 'erro' }, { status: 500 });
  }
}

export { POST };
