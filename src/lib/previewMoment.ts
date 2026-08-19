type PreviewMomentAsset = {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    tags?: unknown;
    triggers?: unknown;
    media_type?: string | null;
    ai_analysis?: Record<string, unknown> | null;
};

type PreviewPeriod = 'madrugada' | 'manha' | 'tarde' | 'noite';

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const list = (value: unknown) => Array.isArray(value) ? value.map(String).join(' ') : String(value || '');

const localPeriod = (timeZone?: string | null, now = new Date()): PreviewPeriod => {
    let effectiveTimeZone = String(timeZone || '').trim() || 'America/Sao_Paulo';
    try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: effectiveTimeZone }).format(now);
    } catch {
        effectiveTimeZone = 'America/Sao_Paulo';
    }

    const hour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTimeZone,
        hour: '2-digit',
        hour12: false,
    }).format(now)) % 24;
    return hour < 6 ? 'madrugada' : hour < 12 ? 'manha' : hour < 18 ? 'tarde' : 'noite';
};

const deterministicPick = (items: string[], seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return items[(hash >>> 0) % items.length];
};

const compatiblePeriods = (analysis: Record<string, unknown>) => {
    const raw = analysis.time_compatibility;
    if (Array.isArray(raw)) return raw.map(normalize).filter(Boolean);
    return normalize(raw).split(/[;,|/]/).map((item) => item.trim()).filter(Boolean);
};

export const buildDeliveredPreviewCaption = ({
    asset,
    userText,
    timeZone,
    now = new Date(),
}: {
    asset: PreviewMomentAsset | null | undefined;
    userText?: string;
    timeZone?: string | null;
    now?: Date;
}) => {
    if (!asset || String(asset.media_type || '') !== 'image') return '';

    const analysis = asset.ai_analysis && typeof asset.ai_analysis === 'object' ? asset.ai_analysis : {};
    const searchable = normalize([
        asset.name,
        asset.description,
        list(asset.tags),
        list(asset.triggers),
        analysis.visual_summary,
        analysis.pose,
        analysis.outfit,
        analysis.setting,
        analysis.expression,
        analysis.explicitness,
        list(analysis.accessories),
        list(analysis.body_focus),
        list(analysis.tags),
        analysis.moment_context,
    ].join(' '));
    const period = localPeriod(timeZone, now);
    const periods = compatiblePeriods(analysis);
    const periodMatches = periods.length === 0
        || periods.includes('qualquer')
        || periods.includes('any')
        || periods.includes(period);
    const looksProduced = /\b(estudio|ensaio profissional|editorial|palco|evento|festa|praia|piscina|parque|rua|area externa|montagem|colagem|print|captura de tela)\b/i.test(searchable);
    const instantSignal = /\b(selfie|espelho|cama|deitad|quarto|banho|chuveiro|banheiro|toalha|molhad|roupao|sofa|sentad|lingerie|calcinha|sutia|nua|pelada|sem roupa|de quatro|empinad|bunda|rosto|decote)\b/i.test(searchable);
    const explicitlyFresh = analysis.plausible_as_recent === true;
    const explicitlyArchived = analysis.plausible_as_recent === false;
    const canBeFromNow = periodMatches && !explicitlyArchived && !looksProduced && (explicitlyFresh || instantSignal);
    const seed = `${asset.id || asset.name || searchable}:${period}:${normalize(userText)}`;

    // Quando a cena nao sustenta continuidade temporal, a legenda continua humana
    // sem inventar que a foto acabou de ser tirada.
    if (!canBeFromNow) {
        return deterministicPick([
            'essa combina demais com o que vc falou',
            'essa aqui tem exatamente a energia que vc despertou em mim',
            'essa vai alimentar ainda mais sua imaginação',
        ], seed);
    }

    if (/\b(banho|chuveiro|banheiro|toalha|molhad|roupao|espuma)\b/i.test(searchable)) {
        return deterministicPick([
            'acabei de sair do banho e tirei essa agora pensando em vc',
            'saí do banho agora e não resisti a tirar essa pra vc',
            'tava me secando depois do banho e tirei essa aqui só pra vc',
        ], seed);
    }

    if (/\b(cama|deitad|lencol|travesseiro|quarto)\b/i.test(searchable)) {
        const byPeriod: Record<PreviewPeriod, string[]> = {
            madrugada: [
                'perdi o sono e tirei essa deitadinha pensando em vc',
                'to aqui na cama essa hora e acabei tirando essa pra vc',
            ],
            manha: [
                'acordei toda preguiçosa e tirei essa aqui pra vc',
                'ainda to deitadinha e acabei tirando essa pensando em vc',
            ],
            tarde: [
                'me joguei na cama agora e tirei essa pensando em vc',
                'to aqui deitadinha e acabei tirando essa pra vc',
            ],
            noite: [
                'to aqui deitadinha agora e tirei essa pensando em vc',
                'vim pra cama e acabei tirando essa aqui só pra vc',
                'olha como eu to deitadinha agora pensando em vc',
            ],
        };
        return deterministicPick(byPeriod[period], seed);
    }

    if (/\b(espelho|selfie|rosto|carinha|olhar)\b/i.test(searchable)) {
        return deterministicPick([
            'peguei o celular e tirei essa agora olhando pra vc',
            'acabei de tirar essa carinha pensando no que vc falou',
            'tirei essa agora só pra vc ver como eu fiquei',
        ], seed);
    }

    if (/\b(lingerie|calcinha|sutia|renda|body)\b/i.test(searchable)) {
        return deterministicPick([
            'coloquei isso aqui e fui tirar uma fotinha agora pra vc',
            'experimentei isso agora e tirei essa pensando em vc',
            'vc me provocou e eu fui tirar essa aqui pra vc',
        ], seed);
    }

    if (/\b(nua|pelada|sem roupa|explicit|bunda|de quatro|empinad|peito|seio)\b/i.test(searchable)) {
        return deterministicPick([
            'vc me deixou com tanta vontade que fui tirar essa agora pra vc',
            'não aguentei a provocação e acabei tirando essa aqui agora',
            'olha o que vc me fez tirar agora pensando em vc',
        ], seed);
    }

    return deterministicPick([
        'tirei essa agora pensando em vc',
        'acabei de tirar essa aqui só pra vc',
        'vc me veio na cabeça e eu fui tirar essa agora',
    ], seed);
};
