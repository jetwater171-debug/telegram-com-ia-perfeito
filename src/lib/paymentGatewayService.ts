import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { WiinPayService, type CreatePaymentParams, type PaymentResponse } from '@/lib/wiinpayService';

export type PaymentGatewayId = 'wiinpay' | 'pushinpay';

type GatewaySettings = {
  order: PaymentGatewayId[];
  wiinpay: {
    enabled: boolean;
    apiKey: string;
  };
  pushinpay: {
    enabled: boolean;
    apiKey: string;
    environment: 'production' | 'sandbox';
  };
  webhookBaseUrl: string;
  webhookToken: string;
};

type GatewayAttempt = {
  gateway: PaymentGatewayId;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

type MultiGatewayPaymentResponse = PaymentResponse & {
  gateway: PaymentGatewayId;
  gatewayLabel: string;
  gatewayAttempts: GatewayAttempt[];
  raw?: any;
};

const DEFAULT_ORDER: PaymentGatewayId[] = ['wiinpay', 'pushinpay'];
const PUSHINPAY_PRODUCTION_URL = 'https://api.pushinpay.com.br/api';
const PUSHINPAY_SANDBOX_URL = 'https://api-sandbox.pushinpay.com.br/api';

const toText = (value: any) => String(value || '').trim();

const parseBoolean = (value: any, fallback = false) => {
  const text = toText(value).toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on', 'sim', 'ligado'].includes(text);
};

const normalizeGateway = (value: any): PaymentGatewayId | null => {
  const text = toText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (text === 'wiinpay' || text === 'wiin') return 'wiinpay';
  if (text === 'pushinpay' || text === 'pushin' || text === 'pushinpaypix') return 'pushinpay';
  return null;
};

const normalizeOrder = (value: any) => {
  const raw = Array.isArray(value) ? value : toText(value).split(',');
  const parsed = raw
    .map(normalizeGateway)
    .filter((item): item is PaymentGatewayId => Boolean(item));
  return Array.from(new Set([...parsed, ...DEFAULT_ORDER]));
};

const maskSecret = (value?: string | null) => {
  const secret = toText(value);
  if (!secret) return '';
  if (secret.length <= 12) return '********';
  return `${secret.slice(0, 7)}...${secret.slice(-4)}`;
};

const loadSettingsMap = async () => {
  const keys = [
    'payment_gateway_order',
    'payment_wiinpay_enabled',
    'payment_wiinpay_api_key',
    'payment_pushinpay_enabled',
    'payment_pushinpay_api_key',
    'payment_pushinpay_environment',
    'payment_webhook_base_url',
    'payment_webhook_token',
  ];
  const { data, error } = await supabase.from('bot_settings').select('key,value').in('key', keys);
  if (error) throw error;
  return Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ''])) as Record<string, string>;
};

export const loadPaymentGatewaySettings = async (): Promise<GatewaySettings> => {
  const map = await loadSettingsMap();
  const pushinEnvironment = toText(map.payment_pushinpay_environment || process.env.PUSHINPAY_ENVIRONMENT).toLowerCase();

  return {
    order: normalizeOrder(map.payment_gateway_order || process.env.PAYMENT_GATEWAY_ORDER),
    wiinpay: {
      enabled: parseBoolean(map.payment_wiinpay_enabled || process.env.WIINPAY_ENABLED, Boolean(map.payment_wiinpay_api_key || process.env.WIINPAY_API_KEY)),
      apiKey: toText(map.payment_wiinpay_api_key || process.env.WIINPAY_API_KEY),
    },
    pushinpay: {
      enabled: parseBoolean(map.payment_pushinpay_enabled || process.env.PUSHINPAY_ENABLED, Boolean(map.payment_pushinpay_api_key || process.env.PUSHINPAY_API_KEY)),
      apiKey: toText(map.payment_pushinpay_api_key || process.env.PUSHINPAY_API_KEY),
      environment: pushinEnvironment === 'sandbox' ? 'sandbox' : 'production',
    },
    webhookBaseUrl: toText(map.payment_webhook_base_url || process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL),
    webhookToken: toText(map.payment_webhook_token || process.env.PAYMENT_WEBHOOK_TOKEN),
  };
};

export const getPaymentGatewayAdminSnapshot = async () => {
  const map = await loadSettingsMap();
  const settings = await loadPaymentGatewaySettings();
  return {
    order: settings.order.join(','),
    webhookBaseUrl: settings.webhookBaseUrl,
    wiinpay: {
      enabled: settings.wiinpay.enabled,
      saved: Boolean(map.payment_wiinpay_api_key),
      masked: maskSecret(settings.wiinpay.apiKey),
      envFallback: Boolean(!map.payment_wiinpay_api_key && process.env.WIINPAY_API_KEY),
    },
    pushinpay: {
      enabled: settings.pushinpay.enabled,
      saved: Boolean(map.payment_pushinpay_api_key),
      masked: maskSecret(settings.pushinpay.apiKey),
      envFallback: Boolean(!map.payment_pushinpay_api_key && process.env.PUSHINPAY_API_KEY),
      environment: settings.pushinpay.environment,
    },
    webhook: {
      tokenSaved: Boolean(map.payment_webhook_token),
      tokenMasked: maskSecret(settings.webhookToken),
      envFallback: Boolean(!map.payment_webhook_token && process.env.PAYMENT_WEBHOOK_TOKEN),
    },
  };
};

export const savePaymentGatewaySettings = async (body: any) => {
  const rows: { key: string; value: string }[] = [
    { key: 'payment_gateway_order', value: normalizeOrder(body?.order).join(',') },
    { key: 'payment_wiinpay_enabled', value: body?.wiinpay?.enabled === false ? 'false' : 'true' },
    { key: 'payment_pushinpay_enabled', value: body?.pushinpay?.enabled === false ? 'false' : 'true' },
    { key: 'payment_pushinpay_environment', value: body?.pushinpay?.environment === 'sandbox' ? 'sandbox' : 'production' },
    { key: 'payment_webhook_base_url', value: toText(body?.webhookBaseUrl) },
  ];

  const wiinpayApiKey = toText(body?.wiinpay?.apiKey);
  const pushinpayApiKey = toText(body?.pushinpay?.apiKey);
  const webhookToken = toText(body?.webhookToken);
  if (wiinpayApiKey && !wiinpayApiKey.includes('*')) rows.push({ key: 'payment_wiinpay_api_key', value: wiinpayApiKey });
  if (pushinpayApiKey && !pushinpayApiKey.includes('*')) rows.push({ key: 'payment_pushinpay_api_key', value: pushinpayApiKey });
  if (webhookToken && !webhookToken.includes('*')) rows.push({ key: 'payment_webhook_token', value: webhookToken });

  const { error } = await supabase.from('bot_settings').upsert(rows);
  if (error) throw error;
};

const gatewayLabel = (gateway: PaymentGatewayId) => gateway === 'pushinpay' ? 'PushinPay' : 'WiinPay';

const pushinpayBaseUrl = (environment: 'production' | 'sandbox') => environment === 'sandbox'
  ? PUSHINPAY_SANDBOX_URL
  : PUSHINPAY_PRODUCTION_URL;

const buildWebhookUrl = (settings: GatewaySettings, gateway: PaymentGatewayId) => {
  if (!settings.webhookBaseUrl) return '';
  try {
    const url = new URL('/api/payment/webhook', settings.webhookBaseUrl);
    url.searchParams.set('gateway', gateway);
    if (settings.webhookToken) url.searchParams.set('token', settings.webhookToken);
    return url.toString();
  } catch {
    return '';
  }
};

const normalizePushinpayCreateResponse = (data: any): PaymentResponse => {
  const root = data && typeof data === 'object' ? data : {};
  const nested = root.data && typeof root.data === 'object' ? root.data : {};
  const source = Object.keys(nested).length ? nested : root;
  const pixCode = toText(source.qr_code || source.qrCode || source.pixCopiaCola || source.pix_code || source.pixCode);
  return {
    paymentId: toText(source.id || source.transaction_id || source.transactionId || root.id),
    qrCode: pixCode,
    pixCopiaCola: pixCode,
    qrCodeBase64: toText(source.qr_code_base64 || source.qrCodeBase64),
    status: toText(source.status || root.status) || 'created',
    raw: data,
  };
};

const createPushinpayPayment = async (params: CreatePaymentParams, settings: GatewaySettings): Promise<PaymentResponse> => {
  const valueInCents = Math.round(Number(params.value || 0) * 100);
  if (valueInCents < 50) throw new Error('PushinPay exige valor minimo de 50 centavos');
  const webhookUrl = params.webhook_url || buildWebhookUrl(settings, 'pushinpay');
  const response = await fetch(`${pushinpayBaseUrl(settings.pushinpay.environment)}/pix/cashIn`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.pushinpay.apiKey}`,
    },
    body: JSON.stringify({
      value: valueInCents,
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    }),
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`PushinPay Failed (${response.status}): ${data?.message || data?.error || text || 'erro'}`);
  }
  const normalized = normalizePushinpayCreateResponse(data);
  if (!normalized.paymentId || !normalized.pixCopiaCola) throw new Error('PushinPay retornou PIX sem id ou codigo copia-e-cola');
  return normalized;
};

export const createPaymentMultiGateway = async (params: CreatePaymentParams): Promise<MultiGatewayPaymentResponse> => {
  const settings = await loadPaymentGatewaySettings();
  const attempts: GatewayAttempt[] = [];

  for (const gateway of settings.order) {
    const config = settings[gateway];
    if (!config.enabled) {
      attempts.push({ gateway, ok: false, skipped: true, reason: 'disabled' });
      continue;
    }
    if (!config.apiKey) {
      attempts.push({ gateway, ok: false, skipped: true, reason: 'missing_credentials' });
      continue;
    }

    try {
      const payment = gateway === 'wiinpay'
        ? await WiinPayService.createPayment(params, { apiKey: settings.wiinpay.apiKey })
        : await createPushinpayPayment(params, settings);
      attempts.push({ gateway, ok: true });
      return {
        ...payment,
        gateway,
        gatewayLabel: gatewayLabel(gateway),
        gatewayAttempts: attempts,
      };
    } catch (error: any) {
      attempts.push({ gateway, ok: false, error: error?.message || String(error) });
    }
  }

  const detail = attempts.map((item) => `${item.gateway}:${item.reason || item.error || 'failed'}`).join(' | ');
  throw new Error(`all_payment_gateways_failed: ${detail || 'no_gateway_available'}`);
};

const getPushinpayStatus = async (paymentId: string) => {
  const settings = await loadPaymentGatewaySettings();
  if (!settings.pushinpay.apiKey) throw new Error('PUSHINPAY_API_KEY not configured');
  const response = await fetch(`${pushinpayBaseUrl(settings.pushinpay.environment)}/transactions/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${settings.pushinpay.apiKey}`,
    },
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    return {
      ok: false,
      gateway: 'pushinpay',
      http_status: response.status,
      error: data?.message || data?.error || text || 'Failed to fetch PushinPay status',
      data,
    };
  }
  return {
    ok: true,
    gateway: 'pushinpay',
    http_status: response.status,
    ...data,
  };
};

export const getPaymentStatusMultiGateway = async (paymentId: string, gateway?: string) => {
  const normalized = normalizeGateway(gateway) || 'wiinpay';
  if (normalized === 'pushinpay') return getPushinpayStatus(paymentId);
  const settings = await loadPaymentGatewaySettings();
  return WiinPayService.getPaymentStatus(paymentId, { apiKey: settings.wiinpay.apiKey });
};

export const normalizePaymentGatewayId = normalizeGateway;
