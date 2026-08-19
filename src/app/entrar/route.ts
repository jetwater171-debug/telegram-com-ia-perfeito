import { randomBytes } from 'crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const tokenUsernameCache = new Map<string, { username: string; cachedAt: number }>();
const activeFetches = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 60 * 1000;

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
    const timeout = setTimeout(() => controller.abort(), 700);
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

const getActiveBotToken = async (): Promise<string> => {
    const { data: tokenSetting } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const token = tokenSetting?.value
        ? String(tokenSetting.value).trim()
        : (process.env.TELEGRAM_BOT_TOKEN || '').trim();

    return token;
};

const getTelegramBotUsername = async (token: string): Promise<string> => {
    const cleanToken = token.trim();
    if (!cleanToken) return '';

    const cached = tokenUsernameCache.get(cleanToken);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
        return cached.username;
    }

    const ongoing = activeFetches.get(cleanToken);
    if (ongoing) return ongoing;

    const fetchPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
                cache: 'no-store',
                signal: controller.signal
            }).finally(() => clearTimeout(timeout));

            if (res.ok) {
                const json = await res.json();
                const username = json?.result?.username ? String(json.result.username).replace(/^@/, '').trim() : '';
                if (username) {
                    tokenUsernameCache.set(cleanToken, { username, cachedAt: Date.now() });
                    void supabase.from('bot_settings').upsert({
                        key: 'telegram_bot_username',
                        value: username
                    });
                    return username;
                }
            }
        } catch (err) {
            console.error('[ENTRAR] Error fetching Telegram getMe for token:', err);
        }

        if (cached?.username) {
            return cached.username;
        }

        const { data: dbUsername } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', 'telegram_bot_username')
            .single();

        if (dbUsername?.value) {
            const fallback = String(dbUsername.value).replace(/^@/, '').trim();
            tokenUsernameCache.set(cleanToken, { username: fallback, cachedAt: Date.now() });
            return fallback;
        }

        return '';
    })();

    activeFetches.set(cleanToken, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        activeFetches.delete(cleanToken);
    }
};

export async function GET(req: NextRequest) {
    const token = await getActiveBotToken();
    if (!token) {
        return NextResponse.json({ error: 'telegram bot token not configured' }, { status: 500 });
    }

    const username = await getTelegramBotUsername(token);
    if (!username) {
        return NextResponse.json({ error: 'telegram bot username not found for the active token' }, { status: 500 });
    }

    const url = req.nextUrl;
    const code = makeCode();
    const ip = getClientIp(req);
    const headerGeo = getHeaderGeo(req);
    const geo = {
        country: headerGeo.country || '',
        region: headerGeo.region || '',
        city: headerGeo.city || '',
        timezone: headerGeo.timezone || ''
    };
    const utm: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid']) {
        const value = url.searchParams.get(key);
        if (value) utm[key] = value.slice(0, 500);
    }
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
        if (!key) return;
        queryParams[key.slice(0, 120)] = value.slice(0, 500);
    });

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
            host: req.headers.get('host') || '',
            query_params: queryParams
        }
    };

    const { error } = await supabase.from('lead_redirects').insert(payload);
    if (error) {
        console.error('[LEAD REDIRECT] insert failed:', error);
    }

    if (!geo.city && isPublicIp(ip)) {
        after(async () => {
            const ipGeo = await lookupGeoByIp(ip);
            if (!(ipGeo as any).city && !(ipGeo as any).country) return;
            const { error: updateError } = await supabase
                .from('lead_redirects')
                .update({
                    country: (ipGeo as any).country || null,
                    region: (ipGeo as any).region || null,
                    city: (ipGeo as any).city || null,
                    timezone: (ipGeo as any).timezone || null
                })
                .eq('code', code)
                .is('claimed_at', null);
            if (updateError) console.error('[LEAD REDIRECT] geo update failed:', updateError);
        });
    }

    return NextResponse.redirect(`https://t.me/${username}?start=${encodeURIComponent(code)}`, 302);
}
