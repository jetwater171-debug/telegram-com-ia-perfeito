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
 * Todo lead recebe o pipeline completo de tres cerebros. Os niveis continuam
 * existindo apenas para ajustar a quantidade de memoria recuperada, nunca para
 * reduzir estrategia ou revisao de quem ainda nao comprou.
 */
export const resolveAiOrchestrationPlan = (totalPaidInput: unknown): AiOrchestrationPlan => {
    const totalPaid = normalizePaid(totalPaidInput);

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.elite) {
        return {
            tier: 'elite',
            label: 'cliente elite',
            totalPaid,
            separateStrategy: true,
            reviewMode: 'always',
            evaluator: false,
            historyMessageLimit: 48,
            historyMaxEntries: 36,
            historyMaxChars: 18_000,
            promptBlockMaxChars: 12_000,
            objective: 'tres cerebros sempre ativos com maxima continuidade e personalizacao',
        };
    }

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.premium) {
        return {
            tier: 'premium',
            label: 'cliente premium',
            totalPaid,
            separateStrategy: true,
            reviewMode: 'always',
            evaluator: false,
            historyMessageLimit: 44,
            historyMaxEntries: 34,
            historyMaxChars: 17_000,
            promptBlockMaxChars: 12_000,
            objective: 'tres cerebros sempre ativos com revisao completa',
        };
    }

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.buyer) {
        return {
            tier: 'buyer',
            label: 'cliente ativo',
            totalPaid,
            separateStrategy: true,
            reviewMode: 'always',
            evaluator: false,
            historyMessageLimit: 40,
            historyMaxEntries: 32,
            historyMaxChars: 16_000,
            promptBlockMaxChars: 11_000,
            objective: 'tres cerebros sempre ativos para conduzir, vender e revisar',
        };
    }

    return {
        tier: 'starter',
        label: 'primeiro ciclo',
        totalPaid,
        separateStrategy: true,
        reviewMode: 'always',
        evaluator: false,
        historyMessageLimit: 36,
        historyMaxEntries: 30,
        historyMaxChars: 15_000,
        promptBlockMaxChars: 10_000,
        objective: 'tres cerebros sempre ativos desde o primeiro contato',
    };
};

export const shouldRunAiReview = (
    plan: AiOrchestrationPlan,
    criticalReviewNeeded: boolean,
) => plan.reviewMode === 'always'
    || (plan.reviewMode === 'critical' && criticalReviewNeeded);
