import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import {
    buildElevenV3Performance,
    DEFAULT_ELEVENLABS_SETTINGS,
    generateElevenLabsAudio,
    normalizeElevenLabsSettings,
} from "@/lib/elevenLabs";

const readSecret = (value?: string | null) => {
    const secret = String(value || "").trim();
    return secret && !secret.startsWith("YOUR_") ? secret : "";
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { data, error } = await supabase
            .from("bot_settings")
            .select("key,value")
            .in("key", ["elevenlabs_api_key", "elevenlabs_voice_id", "elevenlabs_model", "fish_audio_api_key", "fish_audio_voice_id", "fish_audio_model"]);
        if (error) throw error;

        const map = Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""])) as Record<string, string>;
        const apiKey = readSecret(String(body.fishAudioApiKey || ""))
            || readSecret(map.elevenlabs_api_key)
            || readSecret(process.env.ELEVENLABS_API_KEY)
            || readSecret(map.fish_audio_api_key)
            || readSecret(process.env.FISH_AUDIO_API_KEY);

        const settings = normalizeElevenLabsSettings({
            apiKey,
            enabled: true,
            voiceId: String(body.fishAudioVoiceId || map.elevenlabs_voice_id || map.fish_audio_voice_id || DEFAULT_ELEVENLABS_SETTINGS.voiceId),
            model: String(body.fishAudioModel || map.elevenlabs_model || map.fish_audio_model || DEFAULT_ELEVENLABS_SETTINGS.model),
        });
        const plainText = String(body.text || "Oi amor… passei rapidinho pra falar baixinho com você. Como você tá?");
        const expressiveText = buildElevenV3Performance({ messageText: plainText, userText: plainText, maxChars: 300 });
        const audio = await generateElevenLabsAudio({ settings, text: expressiveText });

        return new NextResponse(new Uint8Array(audio), {
            headers: {
                "Content-Type": "audio/ogg",
                "Cache-Control": "no-store",
                "Content-Disposition": "inline; filename=teste-lari.ogg",
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Erro ao testar ElevenLabs" }, { status: 500 });
    }
}
