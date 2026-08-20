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
type PreviewSensuality = 'casual' | 'sensual' | 'hot' | 'explicit';

export type PreviewMomentContext = {
    userText?: string;
    preferredTags?: string[];
    timeZone?: string | null;
    now?: Date;
    funnelState?: string | null;
    leadHeat?: number;
};

export type PreviewMomentFit = {
    score: number;
    period: PreviewPeriod;
    requestedSensuality: PreviewSensuality;
    assetSensuality: PreviewSensuality;
    hardMismatch: boolean;
    reasons: string[];
};

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

const sensualityRank: Record<PreviewSensuality, number> = {
    casual: 0,
    sensual: 1,
    hot: 2,
    explicit: 3,
};

const assetSearchableText = (asset: PreviewMomentAsset | null | undefined) => {
    if (!asset) return '';
    const analysis = asset.ai_analysis && typeof asset.ai_analysis === 'object' ? asset.ai_analysis : {};
    return normalize([
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
        analysis.sensuality_level,
        analysis.lighting,
        list(analysis.accessories),
        list(analysis.body_focus),
        list(analysis.tags),
        list(analysis.conversation_contexts),
        analysis.moment_context,
        analysis.send_when,
        list(analysis.avoid_when),
    ].join(' '));
};

const inferAssetSensuality = (asset: PreviewMomentAsset): PreviewSensuality => {
    const analysis = asset.ai_analysis && typeof asset.ai_analysis === 'object' ? asset.ai_analysis : {};
    const declared = normalize(analysis.sensuality_level);
    if (declared === 'casual' || declared === 'sensual' || declared === 'hot' || declared === 'explicit') {
        return declared;
    }

    const explicitness = normalize(analysis.explicitness);
    if (explicitness === 'explicit') return 'explicit';
    if (explicitness === 'nude') return 'hot';
    if (explicitness === 'suggestive') return 'sensual';

    const searchable = assetSearchableText(asset);
    if (/\b(explicit|sexo|penetracao|masturb|gozando|dedando)\b/i.test(searchable)) return 'explicit';
    if (/\b(nua|pelada|sem roupa|nude|peitos de fora|buceta)\b/i.test(searchable)) return 'hot';
    if (/\b(sensual|lingerie|calcinha|sutia|decote|bunda|empinad|provocante)\b/i.test(searchable)) return 'sensual';
    return 'casual';
};

const inferRequestedSensuality = (context: PreviewMomentContext): PreviewSensuality => {
    const text = normalize(`${context.userText || ''} ${(context.preferredTags || []).join(' ')}`);
    const state = normalize(context.funnelState);
    if (/\b(explicit|sexo|penetracao|masturb|dedando|gozando|buceta|foto pelada|nude|sem roupa)\b/i.test(text)) return 'explicit';
    if (/\b(safad|bem quente|putaria|tesao|pelad|peitos|bunda|de quatro)\b/i.test(text)) return 'hot';
    if (/\b(sensual|provocante|lingerie|calcinha|decote|gostosa)\b/i.test(text)) return 'sensual';
    if (/\b(normal|selfie|rosto|carinha|sorriso|look|roupa|vestida)\b/i.test(text)) return 'casual';
    if (/hot talk|trigger phase|preview/.test(state)) return Number(context.leadHeat || 0) >= 60 ? 'hot' : 'sensual';
    return 'casual';
};

export const scorePreviewMomentFit = ({
    asset,
    context,
}: {
    asset: PreviewMomentAsset;
    context: PreviewMomentContext;
}): PreviewMomentFit => {
    const analysis = asset.ai_analysis && typeof asset.ai_analysis === 'object' ? asset.ai_analysis : {};
    const period = localPeriod(context.timeZone, context.now || new Date());
    const periods = compatiblePeriods(analysis);
    const requestedSensuality = inferRequestedSensuality(context);
    const assetSensuality = inferAssetSensuality(asset);
    const requestedRank = sensualityRank[requestedSensuality];
    const assetRank = sensualityRank[assetSensuality];
    const searchable = assetSearchableText(asset);
    const reasons: string[] = [];
    let score = 0;

    if (periods.length === 0 || periods.includes('qualquer') || periods.includes('any')) {
        score += 4;
        reasons.push('horario-flexivel');
    } else if (periods.includes(period)) {
        score += 14;
        reasons.push(`horario-${period}`);
    } else {
        score -= 22;
        reasons.push(`horario-incompativel-${period}`);
    }

    if (/\b(cama|deitad|quarto|lencol|travesseiro|luz baixa)\b/i.test(searchable)) {
        score += period === 'noite' || period === 'madrugada' ? 7 : 1;
        reasons.push(period === 'noite' || period === 'madrugada' ? 'cena-noturna-coerente' : 'cena-de-quarto-neutra');
    }
    if (/\b(praia|parque|rua|externa|sol|ceu azul|piscina)\b/i.test(searchable)) {
        score += period === 'manha' || period === 'tarde' ? 7 : -12;
        reasons.push(period === 'manha' || period === 'tarde' ? 'cena-diurna-coerente' : 'cena-diurna-fora-do-momento');
    }

    const sensualityDelta = assetRank - requestedRank;
    if (sensualityDelta === 0) {
        score += 18;
        reasons.push('intensidade-exata');
    } else if (sensualityDelta === -1) {
        score += 7;
        reasons.push('aquecimento-gradual');
    } else if (sensualityDelta < -1) {
        score -= 3;
        reasons.push('intensidade-abaixo');
    } else {
        score -= sensualityDelta * 18;
        reasons.push('intensidade-acima');
    }

    const declaredContexts = Array.isArray(analysis.conversation_contexts)
        ? analysis.conversation_contexts.map(normalize).filter(Boolean)
        : [];
    const sensualityContext = requestedSensuality === 'casual'
        ? 'casual_chat'
        : requestedSensuality === 'sensual'
            ? 'flirting'
            : requestedSensuality === 'hot'
                ? 'hot_talk'
                : 'explicit_request';
    const stateContext = /\b(welcome|starter|new|discover details|build connection)\b/.test(normalize(context.funnelState))
        ? 'first_contact'
        : sensualityContext;
    if (declaredContexts.includes(stateContext) || declaredContexts.includes(sensualityContext)) {
        score += 10;
        reasons.push(`contexto-${stateContext}`);
    }

    const avoidWhen = Array.isArray(analysis.avoid_when) ? analysis.avoid_when.map(normalize) : [];
    const avoidText = avoidWhen.join(' ');
    const avoidsCurrentPeriod = avoidWhen.includes(period) || avoidText.includes(period);
    const avoidsCurrentContext = [stateContext, sensualityContext].some((contextKey) =>
        avoidWhen.includes(contextKey) || avoidText.includes(contextKey.replace(/_/g, ' '))
    );
    if (avoidsCurrentPeriod || avoidsCurrentContext) {
        score -= 35;
        reasons.push('regra-evitar');
    }

    const hardMismatch = sensualityDelta >= 2 || avoidsCurrentPeriod || avoidsCurrentContext;
    return { score, period, requestedSensuality, assetSensuality, hardMismatch, reasons };
};

export const rankPreviewCandidatesByMoment = <T extends PreviewMomentAsset>({
    assets,
    context,
    baseScore = () => 0,
}: {
    assets: T[];
    context: PreviewMomentContext;
    baseScore?: (asset: T) => number;
}) => {
    const ranked = assets.map((asset) => {
        const moment = scorePreviewMomentFit({ asset, context });
        return { asset, moment, score: baseScore(asset) + moment.score };
    });
    const eligible = ranked.some((entry) => !entry.moment.hardMismatch)
        ? ranked.filter((entry) => !entry.moment.hardMismatch)
        : ranked;
    return eligible.sort((left, right) => right.score - left.score);
};

export const isPhotoTakenNow = ({
    asset,
    timeZone,
    now = new Date(),
}: {
    asset: PreviewMomentAsset | null | undefined;
    timeZone?: string | null;
    now?: Date;
}): boolean => {
    if (!asset || String(asset.media_type || '') !== 'image') return false;

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
    return periodMatches && !explicitlyArchived && !looksProduced && (explicitlyFresh || instantSignal);
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
    const canBeFromNow = isPhotoTakenNow({ asset, timeZone, now });
    const seed = `${asset.id || asset.name || searchable}:${period}:${normalize(userText)}`;

    // Quando a foto for uma prévia de catálogo que não se enquadra como tirada agora:
    if (!canBeFromNow) {
        return deterministicPick([
            'essa previa só mandei pra voce ein amor',
            'essa prévia exclusiva eu separei só pra você amor',
            'separei essa aqui especial que só você tá vendo ein amor',
            'essa previa é só nossa amor, olha que delícia',
        ], seed);
    }

    if (/\b(banho|chuveiro|banheiro|toalha|molhad|roupao|espuma)\b/i.test(searchable)) {
        return deterministicPick([
            'olha amor tirei aqui agora pra voce saindo do banho',
            'saí do banho agorinha e tirei essa só pra vc amor',
            'olha amor tirei aqui agora pra voce toda molhadinha',
        ], seed);
    }

    if (/\b(cama|deitad|lencol|travesseiro|quarto)\b/i.test(searchable)) {
        const byPeriod: Record<PreviewPeriod, string[]> = {
            madrugada: [
                'olha amor tirei aqui agora pra voce deitadinha na cama',
                'to aqui na cama sem sono e tirei essa agorinha só pra vc amor',
            ],
            manha: [
                'olha amor tirei aqui agora pra voce acordando na cama',
                'acabei de acordar e tirei essa aqui na cama só pra vc amor',
            ],
            tarde: [
                'olha amor tirei aqui agora pra voce deitadinha descansando',
                'to aqui na cama e tirei essa agorinha só pra vc amor',
            ],
            noite: [
                'olha amor tirei aqui agora pra voce deitadinha aqui no quarto',
                'to deitada aqui na cama e tirei essa agorinha só pra vc amor',
            ],
        };
        return deterministicPick(byPeriod[period], seed);
    }

    if (/\b(espelho|selfie|rosto|carinha|olhar)\b/i.test(searchable)) {
        return deterministicPick([
            'olha amor tirei aqui agora pra voce no espelho',
            'peguei o celular e tirei essa agorinha olhando pra vc amor',
            'olha amor tirei essa selfie agora aqui só pra vc',
        ], seed);
    }

    if (/\b(lingerie|calcinha|sutia|renda|body)\b/i.test(searchable)) {
        return deterministicPick([
            'olha amor tirei aqui agora pra voce com esse conjuntinho',
            'coloquei essa lingerie agora e tirei essa só pra vc amor',
            'olha amor tirei essa agorinha aqui só pra vc ver',
        ], seed);
    }

    if (/\b(nua|pelada|sem roupa|explicit|bunda|de quatro|empinad|peito|seio)\b/i.test(searchable)) {
        return deterministicPick([
            'olha amor tirei aqui agora pra voce bem safadinha',
            'vc me deixou com tanto calor que tirei essa agorinha só pra vc amor',
            'olha amor tirei aqui agora pra voce... gostou?',
        ], seed);
    }

    return deterministicPick([
        'olha amor tirei aqui agora pra voce',
        'acabei de tirar essa agorinha só pra vc amor',
        'tirei essa aqui agora pensando em vc amor',
    ], seed);
};
