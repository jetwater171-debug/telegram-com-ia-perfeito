import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export async function POST() {
    try {
        const { data: buckets, error } = await supabase.storage.listBuckets();
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        const exists = (buckets || []).some((b: any) => b.name === 'previews');
        if (!exists) {
            const { error: createError } = await supabase.storage.createBucket('previews', {
                public: true,
            });
            if (createError) {
                return NextResponse.json({ error: createError.message }, { status: 500 });
            }
        }
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
