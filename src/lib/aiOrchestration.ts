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
 * A inteligencia cresce com a relacao comercial sem gastar varias chamadas em
 * leads que ainda estao no primeiro contato. O backend continua aplicando as
 * mesmas validacoes de midia, preco e pagamento em todos os niveis.
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
            evaluator: true,
            historyMessageLimit: 100,
            historyMaxEntries: 40,
            historyMaxChars: 14_000,
            promptBlockMaxChars: 16_000,
            objective: 'maxima continuidade, personalizacao e controle de qualidade',
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
            historyMessageLimit: 70,
            historyMaxEntries: 30,
            historyMaxChars: 9_000,
            promptBlockMaxChars: 14_000,
            objective: 'planejamento separado e revisao completa em todo turno',
        };
    }

    if (totalPaid >= AI_ORCHESTRATION_THRESHOLDS.buyer) {
        return {
            tier: 'buyer',
            label: 'cliente ativo',
            totalPaid,
            separateStrategy: true,
            reviewMode: 'critical',
            evaluator: false,
            historyMessageLimit: 40,
            historyMaxEntries: 20,
            historyMaxChars: 5_600,
            promptBlockMaxChars: 12_000,
            objective: 'cerebro separado para continuidade com revisao nos momentos criticos',
        };
    }

    return {
        tier: 'starter',
        label: 'primeiro ciclo',
        totalPaid,
        separateStrategy: false,
        reviewMode: 'none',
        evaluator: false,
        historyMessageLimit: 24,
        historyMaxEntries: 14,
        historyMaxChars: 4_200,
        promptBlockMaxChars: 10_000,
        objective: 'uma unica chamada barata unindo leitura, conversa e memoria',
    };
};

export const shouldRunAiReview = (
    plan: AiOrchestrationPlan,
    criticalReviewNeeded: boolean,
) => plan.reviewMode === 'always'
    || (plan.reviewMode === 'critical' && criticalReviewNeeded);

