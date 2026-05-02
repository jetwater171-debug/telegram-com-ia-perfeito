import { NextRequest, NextResponse } from "next/server";
import {
    ADMIN_AUTH_COOKIE,
    ADMIN_AUTH_MAX_AGE_SECONDS,
    createAdminSessionValue,
    getAdminAuthSecret,
    getAdminPassword
} from "@/lib/admin-session";

export async function POST(req: NextRequest) {
    const configuredPassword = getAdminPassword();
    const secret = getAdminAuthSecret();

    if (!configuredPassword || !secret) {
        return NextResponse.json({ error: "admin_password_not_configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const password = String(body?.password || "");

    if (password !== configuredPassword) {
        return NextResponse.json({ error: "invalid_password" }, { status: 401 });
    }

    const sessionValue = await createAdminSessionValue(secret);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
        name: ADMIN_AUTH_COOKIE,
        value: sessionValue,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ADMIN_AUTH_MAX_AGE_SECONDS
    });

    return res;
}
