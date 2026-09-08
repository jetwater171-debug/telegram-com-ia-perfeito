"use client";

import AdminTopbar from "@/components/AdminTopbar";
import { usePathname } from "next/navigation";
import './admin.css';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname();
    return (
        <div className={`admin-shell ${pathname === '/admin/login' ? 'admin-login-shell' : ''} ${pathname.startsWith('/admin/chat/') ? 'admin-chat-shell' : ''}`}>
            <AdminTopbar />
            <div className="admin-workspace" id="admin-content" tabIndex={-1}>{children}</div>
        </div>
    );
}
