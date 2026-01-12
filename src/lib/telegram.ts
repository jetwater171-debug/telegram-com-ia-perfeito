import { Telegraf } from 'telegraf';

export const sendTelegramMessage = async (token: string, chatId: string, text: string) => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.sendMessage(chatId, text);
    } catch (e) {
        console.error("Failed to send text to Telegram:", e);
    }
};

export const sendTelegramPhoto = async (token: string, chatId: string, photoUrl: string, caption?: string) => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.sendPhoto(chatId, photoUrl, { caption });
    } catch (e) {
        console.error("Failed to send photo to Telegram:", e);
    }
};

export const sendTelegramVideo = async (token: string, chatId: string, videoUrl: string, caption?: string) => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);

        // Verificação inteligente para desenvolvimento local
        // Se a URL for do nosso site mas estivermos rodando localmente, tenta pegar o arquivo direto do disco
        if (process.env.NODE_ENV !== 'production' && videoUrl.includes('telegram-com-ia-perfeito.vercel.app')) {
            const fs = await import('fs');
            const path = await import('path');

            // Extrai o caminho relativo da URL (ex: /videos/lari.mp4)
            const urlPath = new URL(videoUrl).pathname;
            // Caminho absoluto no disco (assumindo que roda na raiz do projeto)
            const localPath = path.join(process.cwd(), 'public', urlPath);

            if (fs.existsSync(localPath)) {
                console.log(`[DEV] Enviando arquivo local ao invés de URL remota: ${localPath}`);
                await bot.telegram.sendVideo(chatId, { source: localPath }, { caption });
                return;
            } else {
                console.warn(`[DEV] Arquivo local não encontrado para fallback: ${localPath}`);
            }
        }

        await bot.telegram.sendVideo(chatId, videoUrl, { caption });
    } catch (e) {
        console.error("Failed to send video to Telegram:", e);
    }
};

export const sendTelegramAction = async (token: string, chatId: string, action: 'typing' | 'upload_photo' | 'upload_video' | 'find_location' | 'record_video' | 'record_voice' | 'upload_document' | 'choose_sticker' | 'upload_voice') => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.sendChatAction(chatId, action);
    } catch (e) {
        console.error("Failed to send action to Telegram:", e);
    }
}

export const sendTelegramCopyableCode = async (token: string, chatId: string, code: string) => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);
        // MarkdownV2 requires escaping, but code blocks `...` handle most things?
        // Actually, easiest is `{ parse_mode: 'Markdown' }` and using backticks.
        // Or `HTML` and <code>.
        await bot.telegram.sendMessage(chatId, `\`${code}\``, { parse_mode: 'MarkdownV2' });
    } catch (e) {
        console.error("Failed to send copyable code to Telegram:", e);
    }
}
