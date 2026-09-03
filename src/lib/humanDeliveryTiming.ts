const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number, random: () => number) => {
    const sample = Number(random());
    return Math.floor(min + clamp(Number.isFinite(sample) ? sample : 0, 0, 0.999999) * (max - min + 1));
};

export const humanTextDelayMs = ({
    text,
    bubbleIndex,
    modelDurationMs = 0,
    random = Math.random,
}: {
    text: string;
    bubbleIndex: number;
    modelDurationMs?: number;
    random?: () => number;
}) => {
    const raw = String(text || '').trim();
    const safeBubbleIndex = Number.isFinite(bubbleIndex) ? Math.max(0, Math.floor(bubbleIndex)) : 0;
    const length = raw.length;
    const wordCount = raw.split(/\s+/).filter(Boolean).length;

    // Mesmo quando o modelo já levou alguns segundos, o Telegram precisa exibir
    // uma pequena ação de digitação antes do primeiro balão. Sem isso, a resposta
    // aparece pronta demais e quebra a ilusão de conversa ao vivo.
    if (safeBubbleIndex === 0 && modelDurationMs >= 8_000) {
        return randomBetween(850, 1_350, random);
    }

    const typingTimeMs = (length * 30) + (wordCount * 65) + randomBetween(220, 520, random);
    if (safeBubbleIndex === 0) return clamp(typingTimeMs, 900, 2_900);

    // Balões seguintes incluem a micro pausa de leitura/decisão e o tempo de
    // digitação do novo texto. O teto mantém o worker dentro da janela da rota.
    const readingGapMs = randomBetween(900, 1_550, random);
    return clamp(readingGapMs + typingTimeMs, 1_700, 5_200);
};

export const humanAudioRecordingDelayMs = (text: string, random = Math.random) => {
    const raw = String(text || '').trim();
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    const recordingTimeMs = 1_000 + (wordCount * 180) + randomBetween(200, 500, random);
    return clamp(recordingTimeMs, 1_200, 5_500);
};
