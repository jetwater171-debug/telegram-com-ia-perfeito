export const ADMIN_AUTH_COOKIE = "lari_admin_session";
export const ADMIN_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

export function getAdminPassword() {
    return process.env.ADMIN_PASSWORD || process.env.ADMIN_PANEL_PASSWORD || "";
}

export function getAdminAuthSecret() {
    return process.env.ADMIN_AUTH_SECRET || getAdminPassword();
}

function toBase64Url(bytes: ArrayBuffer) {
    const binary = String.fromCharCode(...new Uint8Array(bytes));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(value: string, secret: string) {
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
    return toBase64Url(signature);
}

function safeEqual(a: string, b: string) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

export async function createAdminSessionValue(secret: string) {
    const issuedAt = Date.now().toString();
    const signature = await sign(issuedAt, secret);
    return `${issuedAt}.${signature}`;
}

export async function verifyAdminSessionValue(value: string | undefined, secret: string) {
    if (!value || !secret) return false;
    const [issuedAt, signature] = value.split(".");
    if (!issuedAt || !signature) return false;

    const issuedAtMs = Number(issuedAt);
    if (!Number.isFinite(issuedAtMs)) return false;
    if (Date.now() - issuedAtMs > ADMIN_AUTH_MAX_AGE_SECONDS * 1000) return false;

    const expected = await sign(issuedAt, secret);
    return safeEqual(signature, expected);
}
