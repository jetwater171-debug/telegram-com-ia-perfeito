import { NextRequest, NextResponse } from 'next/server';
import { testMem0Connection } from '@/lib/mem0LeadMemory';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const readSecret = (value: unknown) => {
    const secret = String(value || '').trim();
    return !secret || secret.includes('*') || secret.startsWith('YOUR_') ? '' : secret;
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { data } = await supabase
            .from('bot_settings')
            .select('key,value')
            .eq('key', 'mem0_api_key')
            .maybeSingle();
        const apiKey = readSecret(body.mem0ApiKey) || readSecret(data?.value) || readSecret(process.env.MEM0_API_KEY);
        if (!apiKey) throw new Error('cole ou salve a chave Mem0 primeiro');

        const result = await testMem0Connection({ apiKey });
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'teste Mem0 falhou' }, { status: 400 });
    }
}
