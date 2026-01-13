import ReengagementWatcher from "@/components/ReengagementWatcher";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <>
            <ReengagementWatcher />
            {children}
        </>
    );
}
