const API_KEY = process.env.WIINPAY_API_KEY;
const BASE_URL = 'https://api-v2.wiinpay.com.br';

export interface CreatePaymentParams {
  value: number;
  name: string;
  email: string;
  description: string;
  webhook_url?: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  paymentId: string;
  qrCode: string;
  pixCopiaCola: string;
  status: string;
  [key: string]: any;
}

export const WiinPayService = {
  async createPayment(params: CreatePaymentParams, options: { apiKey?: string } = {}): Promise<PaymentResponse> {
    const apiKey = options.apiKey || API_KEY;
    if (!apiKey) {
      throw new Error('WIINPAY_API_KEY not configured');
    }
    const value = Number(params.value || 0);
    if (!Number.isFinite(value) || value <= 0) throw new Error('WiinPay recebeu valor invalido');
    if (!String(params.description || '').trim()) throw new Error('WiinPay recebeu descricao vazia');

    const response = await fetch(`${BASE_URL}/payment/create`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        ...params,
        value: Math.round(value * 100) / 100,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const responseText = await response.text();
    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = { raw: responseText };
    }
    if (!response.ok) {
      const detail = String(data?.message || data?.error?.message || responseText || 'erro').slice(0, 500);
      console.error(`WiinPay Error (${response.status}):`, detail);
      throw new Error(`WiinPay Failed (${response.status}): ${detail}`);
    }

    const nested = data?.data && typeof data.data === 'object' ? data.data : {};
    const paymentId = String(data.paymentId || data.payment_id || data.id || nested.paymentId || nested.payment_id || nested.id || '').trim();
    const qrCode = String(data.qr_code || data.qrCode || data.pixCopiaCola || data.pix_code || nested.qr_code || nested.qrCode || nested.pixCopiaCola || nested.pix_code || '').trim();
    if (!paymentId || !qrCode) throw new Error('WiinPay retornou PIX sem id ou codigo copia-e-cola');

    return {
      ...data,
      paymentId,
      qrCode,
      pixCopiaCola: qrCode,
      status: data.status || nested.status || 'pending',
    };
  },

  async getPaymentStatus(paymentId: string, options: { apiKey?: string } = {}): Promise<any> {
    const apiKey = options.apiKey || API_KEY;
    if (!apiKey) {
      throw new Error('WIINPAY_API_KEY not configured');
    }
    const response = await fetch(`${BASE_URL}/payment/list/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'insomnia/11.1.0'
      }
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
        http_status: response.status,
        error: data?.error?.message || data?.message || text || 'Failed to fetch payment status',
        data
      };
    }

    return {
      ok: true,
      gateway: 'wiinpay',
      http_status: response.status,
      ...data
    };
  }
};
