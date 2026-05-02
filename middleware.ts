import { NextRequest, NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE, getAdminAuthSecret, verifyAdminSessionValue } from "./src/lib/admin-session";

const isAdminPage = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");
const isAdminApi = (pathname: string) => pathname.startsWith("/api/admin/");

const isPublicAdminPath = (pathname: string) => {
    return pathname === "/admin/login" || pathname === "/api/admin/login" || pathname === "/api/admin/logout";
};

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    if ((!isAdminPage(pathname) && !isAdminApi(pathname)) || isPublicAdminPath(pathname)) {
        return NextResponse.next();
    }

    const secret = getAdminAuthSecret();
    const sessionCookie = req.cookies.get(ADMIN_AUTH_COOKIE)?.value;
    const isAuthed = await verifyAdminSessionValue(sessionCookie, secret);

    if (isAuthed) {
        return NextResponse.next();
    }

    if (isAdminApi(pathname)) {
        return NextResponse.json({ error: "admin_auth_required" }, { status: 401 });
    }

    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/admin/:path*", "/api/admin/:path*"],
};
