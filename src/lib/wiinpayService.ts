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
    const response = await fetch(`${BASE_URL}/payment/create`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        ...params
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`WiinPay Error (${response.status}):`, errorText);
      throw new Error(`WiinPay Failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    // Force lowercase key check just in case, and check nested 'data' object
    const qrCode = data.qr_code || data.qrCode || data.pixCopiaCola || data.data?.qr_code || data.data?.pixCopiaCola;

    return {
      paymentId: data.paymentId || data.data?.paymentId,
      qrCode: qrCode,
      pixCopiaCola: qrCode,
      status: data.status || 'pending',
      ...data
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
