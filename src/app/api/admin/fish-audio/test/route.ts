import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import {
    buildExpressiveSpeech,
    DEFAULT_FISH_AUDIO_SETTINGS,
    generateFishAudio,
    normalizeFishAudioSettings,
} from "@/lib/fishAudio";

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
            .in("key", ["fish_audio_api_key", "fish_audio_voice_id", "fish_audio_model"]);
        if (error) throw error;

        const map = Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""])) as Record<string, string>;
        const apiKey = readSecret(String(body.fishAudioApiKey || ""))
            || readSecret(map.fish_audio_api_key)
            || readSecret(process.env.FISH_AUDIO_API_KEY);

        const settings = normalizeFishAudioSettings({
            apiKey,
            enabled: true,
            voiceId: String(body.fishAudioVoiceId || map.fish_audio_voice_id || DEFAULT_FISH_AUDIO_SETTINGS.voiceId),
            model: String(body.fishAudioModel || map.fish_audio_model || DEFAULT_FISH_AUDIO_SETTINGS.model),
        });
        const plainText = String(body.text || "Oi amor, passei rapidinho pra te mandar um áudio. Como você tá?");
        const expressiveText = buildExpressiveSpeech({ messageText: plainText, userText: plainText, maxChars: 240 });
        const audio = await generateFishAudio({ settings, text: expressiveText });

        return new NextResponse(new Uint8Array(audio), {
            headers: {
                "Content-Type": "audio/ogg",
                "Cache-Control": "no-store",
                "Content-Disposition": "inline; filename=teste-lari.ogg",
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Erro ao testar Fish Audio" }, { status: 500 });
    }
}
