import { NextRequest, NextResponse } from 'next/server';
import { getPaymentGatewayAdminSnapshot, savePaymentGatewaySettings } from '@/lib/paymentGatewayService';

export async function GET() {
  try {
    return NextResponse.json({ settings: await getPaymentGatewayAdminSnapshot() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'erro' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await savePaymentGatewaySettings(body);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'erro' }, { status: 500 });
  }
}
