import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const MESSAGE_COLUMNS = "id,sender,content,created_at,media_url,media_type";
const clampLimit = (value: string | null) => Math.max(40, Math.min(200, Number(value) || 160));

const loadLeadOrigin = async (session: any) => {
    const byChat = await supabase
        .from("lead_redirects")
        .select("*")
        .eq("telegram_chat_id", session.telegram_chat_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (byChat.data) return byChat.data;

    const bySession = await supabase
        .from("lead_redirects")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return bySession.data || null;
};

const loadMessageDebug = async (sessionId: string, messageId: string) => {
    const target = await supabase
        .from("messages")
        .select("id,sender,content,created_at,ai_debug")
        .eq("session_id", sessionId)
        .eq("id", messageId)
        .maybeSingle();

    if (target.error) throw target.error;
    if (!target.data) return null;
    if (target.data.ai_debug) return {
        aiDebug: target.data.ai_debug,
        thoughtContent: target.data.sender === "thought" ? target.data.content : null,
    };

    if (target.data.sender !== "bot") return { aiDebug: null, thoughtContent: null };

    const createdAt = new Date(target.data.created_at).getTime();
    const lowerBound = new Date(createdAt - 120_000).toISOString();
    const thought = await supabase
        .from("messages")
        .select("content,ai_debug,created_at")
        .eq("session_id", sessionId)
        .eq("sender", "thought")
        .gte("created_at", lowerBound)
        .lte("created_at", target.data.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    return {
        aiDebug: thought.data?.ai_debug || null,
        thoughtContent: thought.data?.content || null,
    };
};

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const telegramChatId = decodeURIComponent(String(id || "")).trim();
        if (!telegramChatId) return NextResponse.json({ error: "chat_id_required" }, { status: 400 });

        const sessionResult = await supabase
            .from("sessions")
            .select("*")
            .eq("telegram_chat_id", telegramChatId)
            .maybeSingle();

        if (sessionResult.error) throw sessionResult.error;
        if (!sessionResult.data) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
        const session = sessionResult.data;

        const debugMessageId = req.nextUrl.searchParams.get("debug");
        if (debugMessageId) {
            const debug = await loadMessageDebug(session.id, debugMessageId);
            return NextResponse.json(debug || { aiDebug: null, thoughtContent: null }, {
                headers: { "Cache-Control": "private, no-store" },
            });
        }

        const limit = clampLimit(req.nextUrl.searchParams.get("limit"));
        const before = req.nextUrl.searchParams.get("before");
        const after = req.nextUrl.searchParams.get("after");
        let messageQuery = supabase
            .from("messages")
            .select(MESSAGE_COLUMNS)
            .eq("session_id", session.id);

        if (after) {
            messageQuery = messageQuery.gt("created_at", after).order("created_at", { ascending: true });
        } else {
            if (before) messageQuery = messageQuery.lt("created_at", before);
            messageQuery = messageQuery.order("created_at", { ascending: false });
        }

        const messagePromise = messageQuery.limit(limit + 1);
        const metadataPromise = after || before
            ? Promise.resolve({ leadOrigin: null, funnelResult: null })
            : Promise.all([
                loadLeadOrigin(session),
                session.funnel_step
                    ? Promise.resolve({ data: null })
                    : supabase
                        .from("funnel_events")
                        .select("step,created_at")
                        .eq("session_id", session.id)
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle(),
            ]).then(([leadOrigin, funnelResult]) => ({ leadOrigin, funnelResult }));

        const [messageResult, metadata] = await Promise.all([messagePromise, metadataPromise]);
        if (messageResult.error) throw messageResult.error;
        const rawMessages = messageResult.data || [];
        const hasMore = !after && rawMessages.length > limit;
        const page = rawMessages.slice(0, limit);
        const messages = after ? page : page.reverse();

        if (after || before) {
            return NextResponse.json({ messages, hasMore }, {
                headers: { "Cache-Control": "private, no-store" },
            });
        }

        return NextResponse.json({
            session,
            messages,
            hasMore,
            leadOrigin: metadata.leadOrigin,
            latestFunnelStep: (metadata.funnelResult as any)?.data?.step || null,
        }, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error: any) {
        console.error("[ADMIN CHAT] falha ao carregar conversa:", error?.message || error);
        return NextResponse.json({ error: "conversation_load_failed" }, { status: 502 });
    }
}
