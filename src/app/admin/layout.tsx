import AdminTopbar from "@/components/AdminTopbar";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="admin-shell">
            <AdminTopbar />
            <div className="admin-workspace">{children}</div>
        </div>
    );
}
