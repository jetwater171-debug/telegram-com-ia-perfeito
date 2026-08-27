import type { AIResponse } from '@/types';

export const NEXT_BEST_ACTIONS = [
    'TALK', 'REACT', 'ASK', 'FLIRT', 'REASSURE',
    'SEND_PREVIEW', 'SEND_FREE_MEDIA', 'EXPLORE_DESIRE', 'BUILD_VALUE',
    'MAKE_OFFER', 'HANDLE_OBJECTION', 'NEGOTIATE', 'CLOSE',
    'GENERATE_PAYMENT', 'CHECK_PAYMENT', 'DELIVER', 'POST_PURCHASE',
    'COOLDOWN', 'CHANGE_TOPIC',
] as const;

export type NextBestAction = typeof NEXT_BEST_ACTIONS[number];
export type MemoryKind = 'fact' | 'hypothesis' | 'preference' | 'episode' | 'outcome';
export type MemoryStatus = 'active' | 'superseded' | 'uncertain' | 'expired';

export type RealityState = {
    adultVerified: boolean;
    payment: {
        totalConfirmed: number;
        lastConfirmedValue: number | null;
        lastConfirmedProduct: string | null;
        pendingPaymentId: string | null;
    };
    media: {
        lastPreviewId: string | null;
        lastMediaUrl: string | null;
        sentPreviewIds: string[];
    };
    commercial: {
        currentOrder: {
            orderId: string;
            product: string;
            amount: number;
            description: string;
            status: string;
            paymentId: string | null;
        } | null;
        lastProductBought: string | null;
        lastPurchaseAt: string | null;
        postPurchaseCooldownUntil: string | null;
    };
};

export type LeadTwinState = {
    relationship: { stage: string; familiarity: number };
    conversationStyle: { messageLength: string; humor: number; directness: number };
    interests: Record<string, number>;
    mediaPreferences: Record<string, number>;
    commercial: { purchaseIntent: number; priceSensitivity: number };
    openLoops: string[];
};

export type EpisodeState = {
    episodeKey: string;
    topic: string;
    summary: string;
    openLoops: string[];
    momentum: number;
};

export type TemporalState = {
    now: string;
    timezone: string;
    lastLeadAt: string | null;
    lastBotAt: string | null;
    previousActivityAt: string | null;
    gapMinutes: number | null;
    gapHours: number | null;
    gapDays: number | null;
    gapBucket: 'live' | 'same_day' | 'returning_day' | 'returning_days' | 'reactivation' | 'unknown';
    crossedCalendarDay: boolean;
};

export type RetrievedMemory = {
    id: string;
    kind: MemoryKind;
    status: MemoryStatus;
    key: string;
    content: string;
    confidence: number;
    importance: number;
    updatedAt: string;
    score: number;
};

export type BrainRuntimeState = {
    reality: RealityState;
    twin: LeadTwinState;
    episode: EpisodeState;
    temporal: TemporalState;
    memories: RetrievedMemory[];
    migrationReady: boolean;
};

export type StructuredMemoryUpdate = {
    kind: MemoryKind;
    key: string;
    content: string;
    confidence: number;
    importance: number;
    status: MemoryStatus;
};

export type MasterBrainResponse = AIResponse & {
    next_best_action?: NextBestAction;
    decision_confidence?: number;
    offer_id?: string | null;
    memory_updates?: StructuredMemoryUpdate[];
};

export type HardValidatorResult = {
    response: MasterBrainResponse;
    allowed: boolean;
    corrections: string[];
};
