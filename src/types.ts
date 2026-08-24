export enum Type {
    OBJECT = 'OBJECT',
    STRING = 'STRING',
    NUMBER = 'NUMBER',
    ARRAY = 'ARRAY',
    BOOLEAN = 'BOOLEAN'
}

export interface Schema {
    type: Type;
    properties?: Record<string, Schema>;
    items?: Schema;
    enum?: string[];
    description?: string;
    required?: string[];
    nullable?: boolean;
}

export interface LeadStats {
    tarado: number;
    carente: number;
    sentimental: number;
    financeiro: number;
    total_paid?: number;
}

export interface PaymentDetails {
    value: number;
    description: string;
}

export interface LeadMemoryPatch {
    best_tone?: string;
    emotional_context?: string;
    relationship_stage?: "new" | "familiar" | "engaged" | "buyer" | "returning";
    next_personal_step?: string;
    wanted_products?: string[];
    rejected_products?: string[];
    desires?: string[];
    objections?: string[];
    known_facts?: string[];
    conversation_hooks?: string[];
    fetiches?: string[];
    favorite_media_types?: string[];
    notes?: string[];
}

export interface AIResponse {
    internal_thought: string;
    lead_classification: "carente" | "tarado" | "curioso" | "frio" | "desconhecido";
    lead_stats: LeadStats;
    extracted_user_name: string | null;
    audio_transcription?: string | null;
    current_state:
    | "WELCOME"
    | "CONNECTION"
    | "TRIGGER_PHASE"
    | "HOT_TALK"
    | "PREVIEW"
    | "SALES_PITCH"
    | "NEGOTIATION"
    | "CLOSING"
    | "PAYMENT_CHECK";
    messages: string[];
    action:
    | "none"
    | "send_video_preview"
    | "send_hot_video_preview"
    | "send_ass_photo_preview"
    | "send_custom_preview"
    | "generate_pix_payment"
    | "check_payment_status"
    | "send_shower_photo"
    | "send_lingerie_photo"
    | "send_wet_finger_photo"
    | "request_app_install"
    ;
    payment_details?: PaymentDetails | null;
    preview_id?: string | null;
    preview_request?: {
        media_type: "photo" | "video";
        description: string;
        tags: string[];
        reason?: string | null;
    } | null;
    lead_memory_patch?: LeadMemoryPatch | null;
    recommended_message_count?: number;
    max_chars_per_message?: number;
    next_best_action?:
    | "TALK" | "REACT" | "ASK" | "FLIRT" | "REASSURE"
    | "SEND_PREVIEW" | "SEND_FREE_MEDIA" | "EXPLORE_DESIRE" | "BUILD_VALUE"
    | "MAKE_OFFER" | "HANDLE_OBJECTION" | "NEGOTIATE" | "CLOSE"
    | "GENERATE_PAYMENT" | "CHECK_PAYMENT" | "DELIVER" | "POST_PURCHASE"
    | "COOLDOWN" | "CHANGE_TOPIC";
    decision_confidence?: number;
    offer_id?: string | null;
    memory_updates?: Array<{
        kind: "fact" | "hypothesis" | "preference" | "episode" | "outcome";
        key: string;
        content: string;
        confidence: number;
        importance: number;
        status: "active" | "superseded" | "uncertain" | "expired";
    }>;
    ai_debug?: AiDebugData | null;
}

export interface AiDebugStage {
    name?: string;
    role?: string;
    model?: string;
    provider?: string;
    duration_ms?: number;
    prompt?: string;
    user_prompt?: string;
    clean_history?: Array<{ role: string; content: string }>;
    gateway_attempts?: string[];
    output?: any;
}

export interface AiDebugData {
    timestamp: string;
    run_id?: string;
    message_index?: number;
    model?: string;
    provider?: string;
    tier?: string;
    duration_ms?: number;
    system_prompt: string;
    user_prompt: string;
    clean_history?: Array<{ role: string; content: string }>;
    raw_response?: Record<string, any>;
    final_response?: Record<string, any>;
    media?: { attached: boolean; mime_type?: string | null };
    stages?: {
        strategy?: AiDebugStage;
        draft?: AiDebugStage;
        review?: AiDebugStage;
        evaluator?: AiDebugStage;
    };
    tokens_estimated?: number;
}
