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
        const mutablePayload = {
            session_id: sessionId,
            payment_id: paymentId,
            gateway: gateway || null,
            request_brief: String(requestBrief || 'pedido personalizado').trim().slice(0, 2_000),
            amount: Math.round(Math.max(0, Number(amount || 0)) * 100) / 100,
            payment_data: {
                ...(paymentData || {}),
                ...(product ? { product } : {}),
                ...(orderId ? { order_id: orderId } : {}),
            },
            updated_at: new Date().toISOString(),
        };
        // O conflito ignora somente o insert. A atualização seguinte não toca no
        // status, portanto um webhook repetido nunca rebaixa in_progress,
        // delivered ou cancelled de volta para awaiting_payment.
        const insert = await supabase.from('custom_orders').upsert({
            ...mutablePayload,
            status: 'awaiting_payment',
        }, { onConflict: 'payment_id', ignoreDuplicates: true });
        if (insert.error) throw insert.error;
        const update = await supabase.from('custom_orders')
            .update(mutablePayload)
            .eq('payment_id', paymentId);
        if (update.error) throw update.error;
        return true;
    } catch (error: any) {
        if (!missingTable(error)) console.warn('[CUSTOM ORDERS] Falha ao registrar pedido:', error?.message || error);
        return false;
    }
};

export const markSessionSalesOrderPaidSafe = async ({
    sessionId,
    orderId,
    paymentId,
    paidAt,
    status = 'paid',
}: {
    sessionId: string;
    orderId?: string | null;
    paymentId?: string | null;
    paidAt?: string | null;
    status?: 'paid' | 'paid_needs_manual_review';
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
        const history = Array.isArray(metadata.sales_order_history)
            ? metadata.sales_order_history.filter((item: any) => item && typeof item === 'object') as Record<string, any>[]
            : [];
        const matches = (candidate: Record<string, any> | null) => Boolean(candidate) && (
            (Boolean(orderId) && String(candidate?.orderId || candidate?.order_id || '') === String(orderId))
            || (Boolean(paymentId) && String(candidate?.paymentId || candidate?.payment_id || '') === String(paymentId))
        );
        const activeMatches = matches(active);
        const historyMatches = history.some((item) => matches(item));
        if (!activeMatches && !historyMatches) return false;
        const paidSnapshot = (candidate: Record<string, any>) => ({
            ...candidate,
            status,
            paymentId: paymentId || candidate.paymentId || null,
            paidAt: paidAt || new Date().toISOString(),
        });
        const nextHistory = history.map((item) => matches(item) ? paidSnapshot(item) : item).slice(-30);
        if (activeMatches && active && !historyMatches) nextHistory.push(paidSnapshot(active));

        const result = await supabase.from('sessions').update({
            lead_memory: {
                ...memory,
                metadata: {
                    ...metadata,
                    sales_active_order: activeMatches && active ? paidSnapshot(active) : active,
                    sales_order_history: nextHistory.slice(-30),
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

export const markCustomOrderPaidSafe = async (
    paymentId: string,
    paidAt?: string | null,
    status: 'paid' | 'paid_needs_manual_review' = 'paid',
) => {
    if (!paymentId) return false;
    try {
        const { data: existing, error: readError } = await supabase
            .from('custom_orders')
            .select('id,status')
            .eq('payment_id', paymentId)
            .maybeSingle();
        if (readError) throw readError;
        if (!existing?.id) return false;

        // Estados operacionais definidos no painel são monotônicos. Uma
        // reconciliação tardia pode enriquecer o pedido, mas nunca deve fazê-lo
        // voltar de produção/entregue/cancelado para "pago".
        if (['in_progress', 'delivered', 'cancelled'].includes(String(existing.status || ''))) return true;

        const result = await supabase.from('custom_orders').update({
            status,
            paid_at: paidAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
            .eq('payment_id', paymentId)
            .eq('status', existing.status);
        if (result.error) throw result.error;
        return true;
    } catch (error: any) {
        if (!missingTable(error)) console.warn('[CUSTOM ORDERS] Falha ao confirmar pedido:', error?.message || error);
        return false;
    }
};
