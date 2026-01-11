import { WiinPayService } from './src/lib/wiinpayService';

async function test() {
    console.log("Testing WiinPay Create Payment...");
    try {
        const result = await WiinPayService.createPayment({
            value: 15.00,
            name: "Test User",
            email: "test_user@example.com",
            description: "Test Payment"
        });
        console.log("Success:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

test();
