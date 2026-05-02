import { NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE } from "@/lib/admin-session";

export async function POST() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
        name: ADMIN_AUTH_COOKIE,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0
    });
    return res;
}
