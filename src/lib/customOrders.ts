import { supabaseServer as supabase } from '@/lib/supabaseServer';

const missingTable = (error: any) => /custom_orders|relation|schema cache/i.test(String(error?.message || error || ''));

export const recordCustomOrderSafe = async ({
    sessionId,
    paymentId,
    gateway,
    requestBrief,
    amount,
    paymentData,
}: {
    sessionId: string;
    paymentId: string;
    gateway?: string | null;
    requestBrief: string;
    amount: number;
    paymentData?: Record<string, unknown>;
}) => {
    try {
        const payload = {
            session_id: sessionId,
            payment_id: paymentId,
            gateway: gateway || null,
            status: 'awaiting_payment',
            request_brief: String(requestBrief || 'pedido personalizado').trim().slice(0, 2_000),
            amount: Math.round(Math.max(0, Number(amount || 0)) * 100) / 100,
            payment_data: paymentData || {},
            updated_at: new Date().toISOString(),
        };
        const result = await supabase.from('custom_orders').upsert(payload, { onConflict: 'payment_id' });
        if (result.error) throw result.error;
    } catch (error: any) {
        if (!missingTable(error)) console.warn('[CUSTOM ORDERS] Falha ao registrar pedido:', error?.message || error);
    }
};

export const markCustomOrderPaidSafe = async (paymentId: string, paidAt?: string | null) => {
    if (!paymentId) return;
    try {
        const result = await supabase.from('custom_orders').update({
            status: 'paid',
            paid_at: paidAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq('payment_id', paymentId);
        if (result.error) throw result.error;
    } catch (error: any) {
        if (!missingTable(error)) console.warn('[CUSTOM ORDERS] Falha ao confirmar pedido:', error?.message || error);
    }
};
