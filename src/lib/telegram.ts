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


        // Envia o vídeo (URL ou File ID direto)
        // Como estamos usando File IDs agora, a verificação de arquivo local foi removida para simplificar.

        await bot.telegram.sendVideo(chatId, videoUrl, { caption });
    } catch (e: any) {
        console.error("Failed to send video to Telegram:", e);
        throw new Error(`Telegram Video Error: ${e.message || JSON.stringify(e)}`);
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

export const getTelegramFilePath = async (token: string, fileId: string): Promise<string | null> => {
    try {
        const url = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok && data.result) {
            return data.result.file_path;
        }
        return null;
    } catch (e) {
        console.error("Error getting file path:", e);
        return null;
    }
};

export const getTelegramFileDownloadUrl = (token: string, filePath: string) => {
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
};
