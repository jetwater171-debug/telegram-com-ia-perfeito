/** Escolha inicial por metadados explícitos; não presume iluminação pela imagem. */
export const selectFirstBedPhoto = <T extends { media_type?: string; name?: string; description?: string; tags?: unknown; ai_analysis?: unknown }>(assets: T[], timezone: string, now = new Date()): T | null => {
    let hour: number;
    try {
        hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now));
    } catch {
        hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now));
    }
    const daytime = hour >= 6 && hour < 18;
    return assets.find(asset => {
        if (!['image', 'photo'].includes(String(asset.media_type || 'image'))) return false;
        const text = [asset.name, asset.description, JSON.stringify(asset.tags || []), JSON.stringify(asset.ai_analysis || {})]
            .join(' ').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        if (!/\b(cama|deitada|bed|lying)\b/.test(text)) return false;
        const day = /\b(dia|diurna|manha|tarde|day|daylight|morning|afternoon)\b/.test(text);
        const night = /\b(noite|noturna|madrugada|night|evening)\b/.test(text);
        return daytime ? day && !night : night && !day;
    }) || null;
};
