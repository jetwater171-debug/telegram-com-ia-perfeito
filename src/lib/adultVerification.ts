export const PRESELL_ADULT_VERIFICATION_SOURCE = 'presell_entry_contract';

const TRUSTED_ADULT_VERIFICATION_SOURCES = new Set([
    'lead_self_declaration',
    'presell_explicit_confirmation',
    PRESELL_ADULT_VERIFICATION_SOURCE,
]);

/**
 * Neste funil, a confirmação de maioridade acontece antes de abrir o Telegram.
 * A variável existe como chave de emergência: definir PRESELL_ADULT_VERIFIED=false
 * restaura o gate dentro do chat sem precisar publicar código novo.
 */
export const isPresellAdultVerificationGuaranteed = (raw = process.env.PRESELL_ADULT_VERIFIED) => {
    const normalized = String(raw ?? '').trim().toLowerCase();
    return !['0', 'false', 'no', 'nao', 'não', 'off', 'disabled'].includes(normalized);
};

export const isTrustedAdultVerificationSource = (source: unknown) => (
    TRUSTED_ADULT_VERIFICATION_SOURCES.has(String(source || '').trim())
);

export const hasTrustedAdultVerification = (metadata: Record<string, unknown> | null | undefined) => (
    metadata?.adult_verified === true
    && isTrustedAdultVerificationSource(metadata.adult_verification_source)
);

export const withPresellAdultVerification = (
    metadata: Record<string, unknown> | null | undefined,
    verifiedAt = new Date().toISOString(),
) => {
    const current = metadata && typeof metadata === 'object' ? metadata : {};
    if (hasTrustedAdultVerification(current)) return { ...current };
    return {
        ...current,
        adult_verified: true,
        adult_verification_source: PRESELL_ADULT_VERIFICATION_SOURCE,
        adult_verified_at: verifiedAt,
    };
};
