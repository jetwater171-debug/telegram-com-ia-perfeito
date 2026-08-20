import { NextResponse } from 'next/server';
import { reconcilePendingPayments } from '@/lib/paymentReconciliation';

export const maxDuration = 60;

export async function POST() {
  try {
    const summary = await reconcilePendingPayments({
      limit: 6,
      minCheckIntervalMs: 20_000,
      notify: true,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error: any) {
    console.error('[PAYMENT SYNC] Falha na conciliacao:', error);
    return NextResponse.json({ ok: false, error: error?.message || 'payment_sync_failed' }, { status: 500 });
  }
}
