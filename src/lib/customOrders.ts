import { supabaseServer as supabase } from '@/lib/supabaseServer';

const missingTable = (error: any) => /custom_orders|relation|schema cache/i.test(String(error?.message || error || ''));

export const recordCustomOrderSafe = async ({
    sessionId,
    paymentId,
    gateway,
    requestBrief,
    amount,
    paymentData,
    product,
    orderId,
}: {
    sessionId: string;
    paymentId: string;
    gateway?: string | null;
    requestBrief: string;
    amount: number;
    paymentData?: Record<string, unknown>;
    product?: string | null;
    orderId?: string | null;
}) => {
    try {
        const payload = {
            session_id: sessionId,
            payment_id: paymentId,
            gateway: gateway || null,
            status: 'awaiting_payment',
            request_brief: String(requestBrief || 'pedido personalizado').trim().slice(0, 2_000),
            amount: Math.round(Math.max(0, Number(amount || 0)) * 100) / 100,
            payment_data: {
                ...(paymentData || {}),
                ...(product ? { product } : {}),
                ...(orderId ? { order_id: orderId } : {}),
            },
            updated_at: new Date().toISOString(),
        };
        const result = await supabase.from('custom_orders').upsert(payload, { onConflict: 'payment_id' });
        if (result.error) throw result.error;
    } catch (error: any) {
        if (!missingTable(error)) console.warn('[CUSTOM ORDERS] Falha ao registrar pedido:', error?.message || error);
    }
};

export const markSessionSalesOrderPaidSafe = async ({
    sessionId,
    orderId,
    paymentId,
    paidAt,
}: {
    sessionId: string;
    orderId?: string | null;
    paymentId?: string | null;
    paidAt?: string | null;
}) => {
    if (!sessionId || (!orderId && !paymentId)) return false;
    try {
        const { data: session, error: readError } = await supabase
            .from('sessions')
            .select('lead_memory')
            .eq('id', sessionId)
            .maybeSingle();
        if (readError) throw readError;
        const memory = session?.lead_memory && typeof session.lead_memory === 'object' && !Array.isArray(session.lead_memory)
            ? session.lead_memory as Record<string, any>
            : {};
        const metadata = memory.metadata && typeof memory.metadata === 'object' && !Array.isArray(memory.metadata)
            ? memory.metadata as Record<string, any>
            : {};
        const active = metadata.sales_active_order && typeof metadata.sales_active_order === 'object'
            ? metadata.sales_active_order as Record<string, any>
            : null;
        if (!active) return false;
        const matchesOrder = Boolean(orderId) && String(active.orderId || active.order_id || '') === String(orderId);
        const matchesPayment = Boolean(paymentId) && String(active.paymentId || active.payment_id || '') === String(paymentId);
        if (!matchesOrder && !matchesPayment) return false;

        const result = await supabase.from('sessions').update({
            lead_memory: {
                ...memory,
                metadata: {
                    ...metadata,
                    sales_active_order: {
                        ...active,
                        status: 'paid',
                        paymentId: paymentId || active.paymentId || null,
                        paidAt: paidAt || new Date().toISOString(),
                    },
                },
                updated_at: new Date().toISOString(),
            },
        }).eq('id', sessionId);
        if (result.error) throw result.error;
        return true;
    } catch (error: any) {
        console.warn('[SALES ORDER] Falha ao fechar pedido ativo:', error?.message || error);
        return false;
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
