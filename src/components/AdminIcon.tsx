import type { CSSProperties } from "react";

const paths = {
    chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
    arrow: "M7 17 17 7M7 7h10v10",
    chevron: "m9 5 7 7-7 7",
    search: "M21 21l-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    refresh: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3a7 7 0 0 0 11.6-2",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
    wallet: "M20 8V5H4a2 2 0 0 0 0 4h17v11H4a2 2 0 0 1-2-2V7M21 12h-5v5h5M17 14.5h.01",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    filter: "M4 7h16M7 12h10M10 17h4",
    clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    close: "m6 6 12 12M6 18 18 6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
    check: "m5 12 4 4L19 6",
} as const;

export default function AdminIcon({ name, className, style }: { name: keyof typeof paths; className?: string; style?: CSSProperties }) {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name]} /></svg>;
}
