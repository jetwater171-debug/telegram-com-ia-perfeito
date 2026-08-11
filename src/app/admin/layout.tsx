import ReengagementWatcher from "@/components/ReengagementWatcher";
import AdminTopbar from "@/components/AdminTopbar";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <>
            <ReengagementWatcher />
            <AdminTopbar />
            {children}
        </>
    );
}
