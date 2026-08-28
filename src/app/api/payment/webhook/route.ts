import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { normalizePaymentGatewayId } from '@/lib/paymentGatewayService';
import { findPaymentMessageForWebhook, reconcilePaymentMessage } from '@/lib/paymentReconciliation';
import { collectPaymentReferenceCandidates, findPaymentStatus, isPaymentPaidPayload } from '@/lib/paymentStatus';

const loadSetting = async (key: string) => {
  const { data } = await supabase.from('bot_settings').select('value').eq('key', key).maybeSingle();
  return String(data?.value || process.env[key.toUpperCase()] || '').trim();
};

const validateWebhookToken = async (req: NextRequest) => {
  const expected = await loadSetting('payment_webhook_token');
  if (!expected) return process.env.NODE_ENV !== 'production';
  const received = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token') || req.headers.get('x-pushinpay-token') || '';
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

async function POST(req: NextRequest) {
  try {
    if (!(await validateWebhookToken(req))) {
      return NextResponse.json({ error: 'invalid_webhook_token' }, { status: 401 });
    }

    const gateway = normalizePaymentGatewayId(req.nextUrl.searchParams.get('gateway')) || 'wiinpay';
    const payload = await req.json().catch(() => ({}));
    const references = collectPaymentReferenceCandidates(payload);
    const transactionId = references[0] || '';
    const status = findPaymentStatus(payload) || 'unknown';
    const paid = isPaymentPaidPayload(payload);

    if (!references.length) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'missing_transaction_id' });
    }

    const paymentMsg = await findPaymentMessageForWebhook(payload, gateway);
    if (!paymentMsg?.id) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'payment_not_found', transactionId, status });
    }

    const result = await reconcilePaymentMessage(paymentMsg, {
      gateway,
      notify: true,
      source: `${gateway}_webhook`,
      statusPayload: payload,
    });

    return NextResponse.json({ ok: true, transactionId, status: result.status, paid: result.paid, counted: result.counted });
  } catch (error: any) {
    console.error('Payment webhook error:', error);
    return NextResponse.json({ error: 'payment_webhook_failed' }, { status: 500 });
  }
}

export { POST };
