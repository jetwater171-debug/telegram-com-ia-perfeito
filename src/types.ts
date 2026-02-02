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
    ;
    payment_details?: PaymentDetails | null;
    preview_id?: string | null;
}
