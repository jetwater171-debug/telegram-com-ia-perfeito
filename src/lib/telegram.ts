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
