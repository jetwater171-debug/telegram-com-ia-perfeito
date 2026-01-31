const API_KEY = process.env.WIINPAY_API_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTFiZmJkZmQ4Y2U4YTAzYzg0NjFhMjkiLCJyb2xlIjoiVVNFUiIsImlhdCI6MTc2NDc3NjY2MX0.ryM5L-iDWg4gXJIHAciiJ7OovZhkkZny2dxyd9Z_U4o";
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
  async createPayment(params: CreatePaymentParams): Promise<PaymentResponse> {
    const response = await fetch(`${BASE_URL}/payment/create`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: API_KEY,
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

  async getPaymentStatus(paymentId: string): Promise<any> {
    const response = await fetch(`${BASE_URL}/payment/list/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch payment status');
    }

    return response.json();
  }
};
