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
