export const normalizePreviewMediaKey = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').toLowerCase().replace(/\/$/, '');
  }
};

export const shouldDeliverRequestedMedia = ({
  userAskedMedia,
  userAffirmedMedia,
  isInitialGreeting,
}: {
  userAskedMedia: boolean;
  userAffirmedMedia: boolean;
  isInitialGreeting: boolean;
}) => {
  const explicitRequest = userAskedMedia || userAffirmedMedia;
  if (isInitialGreeting && !explicitRequest) return false;
  return explicitRequest;
};

export const decideFreePreviewDelivery = ({
  requestedByLead,
  recoveryRequest = false,
  modelAttemptedMedia,
  lastBotDeliveredMedia,
  adultVerified,
  sentPreviewCount,
  userMessagesSinceLastMedia,
  userTurnsInWindow,
  leadHeat,
  currentTextIsHot,
  leadMessageHasSubstance,
  blocksInitiative,
  currentStage,
}: {
  requestedByLead: boolean;
  recoveryRequest?: boolean;
  modelAttemptedMedia: boolean;
  lastBotDeliveredMedia: boolean;
  adultVerified: boolean;
  sentPreviewCount: number;
  userMessagesSinceLastMedia: number;
  userTurnsInWindow: number;
  leadHeat: number;
  currentTextIsHot: boolean;
  leadMessageHasSubstance: boolean;
  blocksInitiative: boolean;
  currentStage: string;
}) => {
  const deliveredCount = Math.max(0, Number.isFinite(sentPreviewCount) ? Math.floor(sentPreviewCount) : 0);
  const fourthPreviewEligible = deliveredCount === 3
    && leadHeat >= 85
    && currentTextIsHot
    && userTurnsInWindow >= 8
    && userMessagesSinceLastMedia >= 2;
  const budgetAvailable = deliveredCount < 3 || fourthPreviewEligible;
  const requestedDeliveryAllowed = requestedByLead
    && adultVerified
    && (recoveryRequest || budgetAvailable);
  const contextualInitiativeAllowed = modelAttemptedMedia
    && !requestedByLead
    && adultVerified
    && budgetAvailable
    && !lastBotDeliveredMedia
    && userMessagesSinceLastMedia >= 2
    && userTurnsInWindow >= 4
    && leadMessageHasSubstance
    && !blocksInitiative
    && currentTextIsHot
    && ['HOT_TALK', 'PREVIEW'].includes(String(currentStage || '').toUpperCase())
    && leadHeat >= 65;

  return {
    budgetAvailable,
    fourthPreviewEligible,
    requestedDeliveryAllowed,
    contextualInitiativeAllowed,
    shouldDeliver: requestedDeliveryAllowed || contextualInitiativeAllowed,
  };
};

export const filterUnsentPreviewAssets = <T extends { media_url?: unknown }>(assets: T[], sentUrls: unknown[]) => {
  const sent = new Set(sentUrls.map(normalizePreviewMediaKey).filter(Boolean));
  return assets.filter((asset) => {
    const key = normalizePreviewMediaKey(asset?.media_url);
    return Boolean(key) && !sent.has(key);
  });
};
