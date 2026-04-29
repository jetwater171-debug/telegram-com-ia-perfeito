import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const getClientIp = (req: NextRequest) => {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || '';
    return req.headers.get('x-real-ip') ||
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-client-ip') ||
        '';
};

const getHeaderGeo = (req: NextRequest) => ({
    country: decodeURIComponent(req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || ''),
    region: decodeURIComponent(req.headers.get('x-vercel-ip-country-region') || req.headers.get('x-vercel-ip-region') || ''),
    city: decodeURIComponent(req.headers.get('x-vercel-ip-city') || ''),
    timezone: decodeURIComponent(req.headers.get('x-vercel-ip-timezone') || '')
});

const makeCode = () => `l_${randomBytes(9).toString('base64url')}`;

const isPublicIp = (ip: string) => {
    if (!ip) return false;
    if (ip === '::1' || ip === '127.0.0.1') return false;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip)) return false;
    return /^[a-f0-9\.:]+$/i.test(ip);
};

const lookupGeoByIp = async (ip: string) => {
    if (!isPublicIp(ip)) return {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    try {
        const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
            cache: 'no-store',
            signal: controller.signal
        });
        if (!res.ok) return {};
        const json = await res.json();
        return {
            country: json?.country_name || json?.country || '',
            region: json?.region || '',
            city: json?.city || '',
            timezone: json?.timezone || ''
        };
    } catch {
        return {};
    } finally {
        clearTimeout(timeout);
    }
};

const getTelegramUsername = async () => {
    const { data: usernameSetting } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_username')
        .single();

    if (usernameSetting?.value) return String(usernameSetting.value).replace(/^@/, '').trim();

    const { data: tokenSetting } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const token = tokenSetting?.value;
    if (!token) return '';

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: 'no-store' });
        const json = await res.json();
        const username = json?.result?.username ? String(json.result.username).trim() : '';
        if (username) {
            await supabase.from('bot_settings').upsert({
                key: 'telegram_bot_username',
                value: username
            });
        }
        return username;
    } catch {
        return '';
    }
};

export async function GET(req: NextRequest) {
    const username = await getTelegramUsername();
    if (!username) {
        return NextResponse.json({ error: 'telegram bot username not configured' }, { status: 500 });
    }

    const url = req.nextUrl;
    const code = makeCode();
    const ip = getClientIp(req);
    const headerGeo = getHeaderGeo(req);
    const ipGeo = headerGeo.city ? {} : await lookupGeoByIp(ip);
    const geo = {
        country: headerGeo.country || (ipGeo as any).country || '',
        region: headerGeo.region || (ipGeo as any).region || '',
        city: headerGeo.city || (ipGeo as any).city || '',
        timezone: headerGeo.timezone || (ipGeo as any).timezone || ''
    };
    const utm: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid']) {
        const value = url.searchParams.get(key);
        if (value) utm[key] = value.slice(0, 500);
    }

    const payload = {
        code,
        ip,
        user_agent: req.headers.get('user-agent') || '',
        referer: req.headers.get('referer') || '',
        country: geo.country || null,
        region: geo.region || null,
        city: geo.city || null,
        timezone: geo.timezone || null,
        source_url: url.toString(),
        utm,
        metadata: {
            accept_language: req.headers.get('accept-language') || '',
            host: req.headers.get('host') || ''
        }
    };

    const { error } = await supabase.from('lead_redirects').insert(payload);
    if (error) {
        console.error('[LEAD REDIRECT] insert failed:', error);
    }

    return NextResponse.redirect(`https://t.me/${username}?start=${encodeURIComponent(code)}`, 302);
}
