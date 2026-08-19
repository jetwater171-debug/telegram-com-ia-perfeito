import type { LeadMemoryPatch } from '@/types';

const RELATIONSHIP_STAGE_RANK: Record<string, number> = {
    new: 0,
    familiar: 1,
    engaged: 2,
    returning: 3,
    buyer: 4,
};

const cleanText = (value: unknown, max = 180) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const memoryKey = (value: string) => cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const mergeUniqueLeadMemoryValues = (base: string[], additions: string[], limit = 12) => {
    const values = [...(base || []), ...(additions || [])]
        .map((value) => cleanText(value, 140))
        .filter(Boolean);
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = memoryKey(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
};

export const normalizeLeadMemory = (input: any) => {
    let memory = input;
    if (typeof memory === 'string') {
        try {
            memory = JSON.parse(memory);
        } catch {
            memory = {};
        }
    }
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) memory = {};

    const metadata = memory.metadata && typeof memory.metadata === 'object' && !Array.isArray(memory.metadata)
        ? memory.metadata
        : {};
    const list = (value: any, limit = 12) => mergeUniqueLeadMemoryValues([], Array.isArray(value) ? value : [], limit);
    const wantedProducts = list(memory.wanted_products)
        .filter((item) => metadata.evaluation_requested === true || memoryKey(item) !== 'avaliacao');
    const stage = cleanText(memory.relationship_stage, 20);

    return {
        dominant_type: cleanText(memory.dominant_type) || 'desconhecido',
        best_tone: cleanText(memory.best_tone),
        emotional_context: cleanText(memory.emotional_context),
        relationship_stage: stage in RELATIONSHIP_STAGE_RANK ? stage : 'new',
        next_personal_step: cleanText(memory.next_personal_step),
        wanted_products: wantedProducts,
        rejected_products: list(memory.rejected_products),
        desires: list(memory.desires),
        objections: list(memory.objections),
        known_facts: list(memory.known_facts, 16),
        conversation_hooks: list(memory.conversation_hooks),
        fetiches: list(memory.fetiches, 10),
        favorite_media_types: list(memory.favorite_media_types, 6),
        price_sensitivity: cleanText(memory.price_sensitivity, 60),
        last_offer: cleanText(memory.last_offer, 140),
        notes: list(memory.notes),
        metadata,
        updated_at: memory.updated_at || null,
    };
};

export const mergeLeadMemoryPatch = (currentMemory: any, patch: LeadMemoryPatch | null | undefined) => {
    const current = normalizeLeadMemory(currentMemory);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current;

    const list = (value: unknown) => Array.isArray(value)
        ? value.map((item) => cleanText(item, 140)).filter(Boolean)
        : [];
    const patchStage = cleanText(patch.relationship_stage, 20);
    const relationshipStage = RELATIONSHIP_STAGE_RANK[patchStage] >= RELATIONSHIP_STAGE_RANK[current.relationship_stage]
        ? patchStage
        : current.relationship_stage;
    const patchWanted = list(patch.wanted_products);
    const patchRejected = list(patch.rejected_products);
    const wantedNow = new Set(patchWanted.map(memoryKey));
    const rejectedNow = new Set(patchRejected.map(memoryKey));
    const wantedProducts = mergeUniqueLeadMemoryValues(current.wanted_products, patchWanted)
        .filter((item) => !rejectedNow.has(memoryKey(item)));
    const rejectedProducts = mergeUniqueLeadMemoryValues(current.rejected_products, patchRejected)
        .filter((item) => !wantedNow.has(memoryKey(item)) || rejectedNow.has(memoryKey(item)));

    return {
        ...current,
        best_tone: cleanText(patch.best_tone) || current.best_tone,
        emotional_context: cleanText(patch.emotional_context) || current.emotional_context,
        relationship_stage: relationshipStage,
        next_personal_step: cleanText(patch.next_personal_step) || current.next_personal_step,
        wanted_products: wantedProducts,
        rejected_products: rejectedProducts,
        desires: mergeUniqueLeadMemoryValues(current.desires, list(patch.desires)),
        objections: mergeUniqueLeadMemoryValues(current.objections, list(patch.objections)),
        known_facts: mergeUniqueLeadMemoryValues(current.known_facts, list(patch.known_facts), 16),
        conversation_hooks: mergeUniqueLeadMemoryValues(current.conversation_hooks, list(patch.conversation_hooks)),
        fetiches: mergeUniqueLeadMemoryValues(current.fetiches, list(patch.fetiches), 10),
        favorite_media_types: mergeUniqueLeadMemoryValues(current.favorite_media_types, list(patch.favorite_media_types), 6),
        notes: mergeUniqueLeadMemoryValues(current.notes, list(patch.notes)),
        updated_at: new Date().toISOString(),
    };
};

