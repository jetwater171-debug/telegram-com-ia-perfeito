import { Telegraf } from 'telegraf';

const REMOTE_MEDIA_TIMEOUT_MS = 15_000;
const MAX_TELEGRAM_MEDIA_BYTES = 49 * 1024 * 1024;

const isHttpUrl = (value: string) => /^https?:\/\//i.test(String(value || '').trim());

export type TelegramMediaProtection = {
    protectContent?: boolean;
    hasSpoiler?: boolean;
};

const mediaProtectionOptions = (caption?: string, protection: TelegramMediaProtection = {}) => ({
    ...(caption ? { caption } : {}),
    ...(protection.protectContent ? { protect_content: true } : {}),
    ...(protection.hasSpoiler ? { has_spoiler: true } : {}),
});

const downloadRemoteMedia = async (url: string, fallbackFilename: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_MEDIA_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`download da midia retornou HTTP ${response.status}`);

    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_TELEGRAM_MEDIA_BYTES) {
        throw new Error(`midia excede ${Math.floor(MAX_TELEGRAM_MEDIA_BYTES / 1024 / 1024)}MB`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('download da midia retornou arquivo vazio');
    if (buffer.length > MAX_TELEGRAM_MEDIA_BYTES) {
        throw new Error(`midia excede ${Math.floor(MAX_TELEGRAM_MEDIA_BYTES / 1024 / 1024)}MB`);
    }

    const pathname = (() => {
        try { return new URL(url).pathname; } catch { return ''; }
    })();
    const filename = pathname.split('/').filter(Boolean).at(-1) || fallbackFilename;
    return { source: buffer, filename };
};

export const sendTelegramMessage = async (token: string, chatId: string, text: string) => {
    if (!token) return;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.sendMessage(chatId, text);
    } catch (e) {
        console.error("Failed to send text to Telegram:", e);
    }
};

export const sendTelegramPhoto = async (
    token: string,
    chatId: string,
    photoUrl: string,
    caption?: string,
    protection: TelegramMediaProtection = {},
) => {
    if (!token) throw new Error('Telegram sem token');
    const bot = new Telegraf(token);
    const options = mediaProtectionOptions(caption, protection);
    try {
        await bot.telegram.sendPhoto(chatId, photoUrl, options);
    } catch (firstError: any) {
        if (isHttpUrl(photoUrl)) {
            try {
                const upload = await downloadRemoteMedia(photoUrl, 'preview.jpg');
                await bot.telegram.sendPhoto(chatId, upload, options);
                return;
            } catch (uploadError: any) {
                console.error('Failed to upload photo to Telegram:', uploadError);
                throw new Error(`Telegram Photo Error: ${uploadError?.message || uploadError}; envio por URL: ${firstError?.message || firstError}`);
            }
        }
        console.error('Failed to send photo to Telegram:', firstError);
        throw new Error(`Telegram Photo Error: ${firstError?.message || JSON.stringify(firstError)}`);
    }
};

// Confirmações financeiras não podem engolir falhas: o reconciliador precisa
// manter o estado reservado para revisão/retry consciente se o Telegram não
// confirmar o request.
export const sendTelegramMessageStrict = async (token: string, chatId: string, text: string) => {
    if (!token) throw new Error('Telegram sem token');
    const bot = new Telegraf(token);
    await bot.telegram.sendMessage(chatId, text);
};

export const sendTelegramVideo = async (
    token: string,
    chatId: string,
    videoUrl: string,
    caption?: string,
    protection: TelegramMediaProtection = {},
) => {
    if (!token) throw new Error('Telegram sem token');
    const bot = new Telegraf(token);
    const options = mediaProtectionOptions(caption, protection);
    try {
        await bot.telegram.sendVideo(chatId, videoUrl, options);
    } catch (firstError: any) {
        if (isHttpUrl(videoUrl)) {
            try {
                const upload = await downloadRemoteMedia(videoUrl, 'preview.mp4');
                await bot.telegram.sendVideo(chatId, upload, { ...options, supports_streaming: true });
                return;
            } catch (uploadError: any) {
                console.error('Failed to upload video to Telegram:', uploadError);
                throw new Error(`Telegram Video Error: ${uploadError?.message || uploadError}; envio por URL: ${firstError?.message || firstError}`);
            }
        }
        console.error('Failed to send video to Telegram:', firstError);
        throw new Error(`Telegram Video Error: ${firstError?.message || JSON.stringify(firstError)}`);
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
        const escaped = code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        await bot.telegram.sendMessage(chatId, `<code>${escaped}</code>`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("Failed to send copyable code to Telegram:", e);
    }
}

export const sendTelegramVoice = async (token: string, chatId: string, audio: Buffer, caption?: string) => {
    if (!token) throw new Error('Telegram sem token');
    const bot = new Telegraf(token);
    await bot.telegram.sendVoice(chatId, { source: audio, filename: 'lari.ogg' }, caption ? { caption } : undefined);
};

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

export const approveChatJoinRequest = async (token: string, chatId: number | string, userId: number | string) => {
    if (!token) return false;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.approveChatJoinRequest(chatId, Number(userId));
        return true;
    } catch (e) {
        console.error("Failed to approve chat join request:", e);
        return false;
    }
};

export const declineChatJoinRequest = async (token: string, chatId: number | string, userId: number | string) => {
    if (!token) return false;
    try {
        const bot = new Telegraf(token);
        await bot.telegram.declineChatJoinRequest(chatId, Number(userId));
        return true;
    } catch (e) {
        console.error("Failed to decline chat join request:", e);
        return false;
    }
};
