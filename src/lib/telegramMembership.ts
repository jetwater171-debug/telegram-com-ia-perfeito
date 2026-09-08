import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseServer } from '@/lib/supabaseServer';

export function telegramWebhookSecret(token: string) {
    return createHmac('sha256', token).update('lari-telegram-webhook-v1').digest('hex');
}

export function validTelegramWebhookSecret(header: string | null, token: string) {
    const expected = telegramWebhookSecret(token);
    return Boolean(header && /^[a-f0-9]{64}$/.test(header) && timingSafeEqual(Buffer.from(header), Buffer.from(expected)));
}

export function isTelegramBlockedError(error: unknown): boolean {
    const response = (error as { response?: { error_code?: number; description?: string } })?.response;
    return response?.error_code === 403 && /bot was blocked by the user/i.test(response.description || '');
}

export async function applyTelegramMembership(chatId: string, blocked: boolean, eventAt: string, updateId?: number) {
    const { data, error } = await supabaseServer.rpc('apply_telegram_membership', {
        p_chat_id: chatId, p_blocked: blocked, p_event_at: eventAt, p_update_id: updateId ?? null,
    });
    if (error) throw new Error(`Falha ao atualizar bloqueio Telegram: ${error.code || 'database_error'}`);
    return Boolean(data);
}

// A failed request can finish after an unblock. Confirm the current Telegram
// status before deleting anything; other 403s never classify a lead as blocked.
export async function handleTelegramBlockedError(token: string, chatId: string, error: unknown, requestStartedAt: string) {
    if (!isTelegramBlockedError(error) || !/^[0-9]+$/.test(chatId)) return;
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: token.split(':')[0] }),
        signal: AbortSignal.timeout(10_000),
    });
    const membership = await response.json();
    if (!membership.ok) throw new Error('Não foi possível confirmar bloqueio no Telegram');
    if (membership.result?.status === 'kicked') {
        // Telegram timestamps have second precision. A fallback without an
        // update_id must sort before a genuine update from the same second.
        const eventAt = new Date(Math.floor(Date.parse(requestStartedAt) / 1000) * 1000).toISOString();
        await applyTelegramMembership(chatId, true, eventAt);
    }
}
