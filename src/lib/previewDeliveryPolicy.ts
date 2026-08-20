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

export const filterUnsentPreviewAssets = <T extends { media_url?: unknown }>(assets: T[], sentUrls: unknown[]) => {
  const sent = new Set(sentUrls.map(normalizePreviewMediaKey).filter(Boolean));
  return assets.filter((asset) => {
    const key = normalizePreviewMediaKey(asset?.media_url);
    return Boolean(key) && !sent.has(key);
  });
};
