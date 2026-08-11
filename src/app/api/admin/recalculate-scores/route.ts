import { NextRequest, NextResponse } from "next/server";
import { calculateLeadScore, toStoredLeadScore } from "@/lib/leadScoring";
import { supabaseServer as supabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const sessionId = String(body?.sessionId || "").trim();
        let query = supabase.from("sessions").select("id,total_paid,funnel_step");
        if (sessionId) query = query.eq("id", sessionId);

        const { data: sessions, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        let updated = 0;
        const failures: Array<{ sessionId: string; error: string }> = [];
        for (const session of sessions || []) {
            const { data: messages, error: messageError } = await supabase
                .from("messages")
                .select("content,created_at")
                .eq("session_id", session.id)
                .eq("sender", "user")
                .order("created_at", { ascending: true })
                .limit(1000);
            if (messageError) {
                failures.push({ sessionId: session.id, error: messageError.message });
                continue;
            }

            const result = calculateLeadScore(messages || [], {
                totalPaid: Number(session.total_paid || 0),
                funnelStep: session.funnel_step || "",
            });
            const { error: updateError } = await supabase.from("sessions").update({ lead_score: toStoredLeadScore(result) }).eq("id", session.id);
            if (updateError) failures.push({ sessionId: session.id, error: updateError.message });
            else updated += 1;
        }

        return NextResponse.json({ ok: failures.length === 0, updated, failures });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Falha ao recalcular scores" }, { status: 500 });
    }
}
