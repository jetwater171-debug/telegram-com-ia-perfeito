export type AiIntelligenceTier = 'starter' | 'buyer' | 'premium' | 'elite';
export type AiReviewMode = 'none' | 'critical' | 'always';

export type AiOrchestrationPlan = {
    tier: AiIntelligenceTier;
    label: string;
    totalPaid: number;
    separateStrategy: boolean;
    reviewMode: AiReviewMode;
    evaluator: boolean;
    historyMessageLimit: number;
    historyMaxEntries: number;
    historyMaxChars: number;
    promptBlockMaxChars: number;
    objective: string;
};

export const AI_ORCHESTRATION_THRESHOLDS = {
    buyer: 19.90,
    premium: 100,
    elite: 200,
} as const;

const normalizePaid = (value: unknown) => Math.max(0, Number(value) || 0);

/**
 * Um Master Brain resolve leitura, estrategia, voz e action na mesma chamada.
 * A revisora e adaptativa: protege somente turnos criticos sem atrasar toda a
 * conversa. Memoria longa fica nas projecoes; historico recente fica enxuto.
 */
export const resolveAiOrchestrationPlan = (totalPaidInput: unknown): AiOrchestrationPlan => {
    const totalPaid = normalizePaid(totalPaidInput);

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.elite) {
        return {
            tier: 'elite',
            label: 'cliente elite',
            totalPaid,
            separateStrategy: false,
            reviewMode: 'critical',
            evaluator: false,
            historyMessageLimit: 30,
            historyMaxEntries: 24,
            historyMaxChars: 14_000,
            promptBlockMaxChars: 8_000,
            objective: 'master brain unico com memoria maxima e revisao apenas critica',
        };
    }

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.premium) {
        return {
            tier: 'premium',
            label: 'cliente premium',
            totalPaid,
            separateStrategy: false,
            reviewMode: 'critical',
            evaluator: false,
            historyMessageLimit: 26,
            historyMaxEntries: 22,
            historyMaxChars: 12_000,
            promptBlockMaxChars: 8_000,
            objective: 'master brain unico com continuidade premium e revisao critica',
        };
    }

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.buyer) {
        return {
            tier: 'buyer',
            label: 'cliente ativo',
            totalPaid,
            separateStrategy: false,
            reviewMode: 'critical',
            evaluator: false,
            historyMessageLimit: 22,
            historyMaxEntries: 20,
            historyMaxChars: 10_000,
            promptBlockMaxChars: 7_000,
            objective: 'master brain unico para conduzir, vender e agir sem latencia extra',
        };
    }

    return {
        tier: 'starter',
        label: 'primeiro ciclo',
        totalPaid,
        separateStrategy: false,
        reviewMode: 'critical',
        evaluator: false,
        historyMessageLimit: 18,
        historyMaxEntries: 16,
        historyMaxChars: 8_000,
        promptBlockMaxChars: 6_000,
        objective: 'master brain unico desde o primeiro contato com resposta rapida',
    };
};

export const shouldRunAiReview = (
    plan: AiOrchestrationPlan,
    criticalReviewNeeded: boolean,
) => plan.reviewMode === 'always'
    || (plan.reviewMode === 'critical' && criticalReviewNeeded);
