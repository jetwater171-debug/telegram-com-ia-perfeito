import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { getTelegramFileDownloadUrl, getTelegramFilePath } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const extractTelegramFileId = (content?: string | null) => {
    const text = String(content || '');
    const match = text.match(/\[(?:PHOTO_UPLOAD|VIDEO_UPLOAD)\]\s+File_ID:\s*([^\s]+)/i);
    return match?.[1]?.trim() || '';
};

const inferMediaType = (content?: string | null, mediaType?: string | null) => {
    if (mediaType === 'image' || mediaType === 'video') return mediaType;
    const text = String(content || '');
    if (/\[PHOTO_UPLOAD\]/i.test(text)) return 'image';
    if (/\[VIDEO_UPLOAD\]/i.test(text)) return 'video';
    return '';
};

const contentTypeFor = (mediaType?: string | null) => {
    if (mediaType === 'video') return 'video/mp4';
    if (mediaType === 'image') return 'image/jpeg';
    return 'application/octet-stream';
};

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    const resolvedParams = await params;
    const messageId = resolvedParams.id;

    const { data: tokenData } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const botToken = tokenData?.value;
    if (!botToken) {
        return NextResponse.json({ error: 'telegram_bot_token nao configurado' }, { status: 500 });
    }

    const { data: message, error } = await supabase
        .from('messages')
        .select('content, media_type')
        .eq('id', messageId)
        .single();

    if (error || !message) {
        return NextResponse.json({ error: 'midia nao encontrada' }, { status: 404 });
    }

    const mediaType = inferMediaType(message.content, message.media_type);
    if (mediaType !== 'image' && mediaType !== 'video') {
        return NextResponse.json({ error: 'mensagem sem foto ou video' }, { status: 400 });
    }

    const fileId = extractTelegramFileId(message.content);
    if (!fileId) {
        return NextResponse.json({ error: 'file_id do Telegram nao encontrado' }, { status: 400 });
    }

    const filePath = await getTelegramFilePath(botToken, fileId);
    if (!filePath) {
        return NextResponse.json({ error: 'Telegram nao retornou o arquivo' }, { status: 502 });
    }

    const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
    const telegramResponse = await fetch(downloadUrl, {
        headers: req.headers.get('range') ? { range: req.headers.get('range') as string } : undefined,
        cache: 'no-store'
    });

    if (!telegramResponse.ok || !telegramResponse.body) {
        return NextResponse.json({ error: 'falha ao baixar midia do Telegram' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', telegramResponse.headers.get('content-type') || contentTypeFor(mediaType));
    headers.set('Cache-Control', 'private, no-store');

    for (const key of ['content-length', 'content-range', 'accept-ranges']) {
        const value = telegramResponse.headers.get(key);
        if (value) headers.set(key, value);
    }

    return new NextResponse(telegramResponse.body, {
        status: telegramResponse.status,
        headers
    });
}
