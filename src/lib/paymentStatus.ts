const PAID_STATUS_WORDS = new Set([
  'approved',
  'paid',
  'completed',
  'confirmed',
  'aprovado',
  'pago',
  'concluido',
  'liquidado',
]);

const REFERENCE_KEYS = new Set([
  'id',
  'paymentid',
  'payment_id',
  'transactionid',
  'transaction_id',
  'txid',
  'externalid',
  'external_id',
  'reference',
  'referenceid',
  'reference_id',
  'uuid',
]);

export const normalizePaymentStatus = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

export const findPaymentStatus = (payload: any): string => {
  const preferredStatus = firstText(
    payload?.payment?.status,
    payload?.payment?.payment_status,
    payload?.data?.payment?.status,
    payload?.data?.payment?.payment_status,
    payload?.transaction?.status,
    payload?.data?.transaction?.status,
    payload?.charge?.status,
    payload?.data?.charge?.status,
    payload?.data?.status,
    payload?.data?.payment_status,
    payload?.data?.paymentStatus,
    payload?.payment_status,
    payload?.paymentStatus,
  );
  if (preferredStatus) return normalizePaymentStatus(preferredStatus);

  const deepStatuses: string[] = [];
  const seen = new Set<object>();
  const walk = (value: any, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item) => walk(item, depth + 1));
      return;
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') walk(child, depth + 1);
    }
    for (const [rawKey, valueAtKey] of Object.entries(value)) {
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key === 'status' || key === 'paymentstatus') {
        const normalized = normalizePaymentStatus(valueAtKey);
        if (normalized) deepStatuses.push(normalized);
      }
    }
  };
  walk(payload?.data, 0);
  const paidDeepStatus = deepStatuses.find((status) => PAID_STATUS_WORDS.has(status));
  if (paidDeepStatus) return paidDeepStatus;
  if (deepStatuses[0]) return deepStatuses[0];

  if (payload?.paid === true || payload?.data?.paid === true || payload?.payment?.paid === true || payload?.data?.payment?.paid === true) return 'paid';
  return normalizePaymentStatus(payload?.status);
};

export const isPaymentPaidPayload = (payload: any): boolean => {
  if (!payload) return false;
  if (payload?.paid === true || payload?.data?.paid === true || payload?.payment?.paid === true || payload?.data?.payment?.paid === true) return true;
  if (payload?.paid_at || payload?.approved_at || payload?.completed_at || payload?.data?.paid_at || payload?.data?.approved_at || payload?.data?.completed_at) return true;
  const seen = new Set<object>();
  const containsPaidMarker = (value: any, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).some((item) => containsPaidMarker(item, depth + 1));
    for (const [rawKey, child] of Object.entries(value)) {
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key === 'paid' && child === true) return true;
      if ((key === 'paidat' || key === 'approvedat' || key === 'completedat') && Boolean(child)) return true;
      if (child && typeof child === 'object' && containsPaidMarker(child, depth + 1)) return true;
    }
    return false;
  };
  if (containsPaidMarker(payload, 0)) return true;
  return PAID_STATUS_WORDS.has(findPaymentStatus(payload));
};

export const collectPaymentReferenceCandidates = (payload: any): string[] => {
  const collected: string[] = [];
  const seenValues = new Set<string>();
  const seenObjects = new Set<object>();

  const add = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const text = String(value).trim();
    if (!text || text.length > 240) return;
    const key = text.toLowerCase();
    if (seenValues.has(key)) return;
    seenValues.add(key);
    collected.push(text);
  };

  const walk = (value: any, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 7 || seenObjects.has(value)) return;
    seenObjects.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item) => walk(item, depth + 1));
      return;
    }
    for (const [rawKey, child] of Object.entries(value)) {
      const key = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (REFERENCE_KEYS.has(key)) add(child);
      if (child && typeof child === 'object') walk(child, depth + 1);
    }
  };

  walk(payload, 0);
  return collected;
};

export const paymentReferenceSetsIntersect = (left: unknown[], right: unknown[]) => {
  const normalized = new Set(left.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return right.some((value) => normalized.has(String(value || '').trim().toLowerCase()));
};
