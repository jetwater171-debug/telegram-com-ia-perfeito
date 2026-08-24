import ReengagementWatcher from "@/components/ReengagementWatcher";
import AdminTopbar from "@/components/AdminTopbar";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="admin-shell">
            <ReengagementWatcher />
            <AdminTopbar />
            <div className="admin-workspace">{children}</div>
        </div>
    );
}
