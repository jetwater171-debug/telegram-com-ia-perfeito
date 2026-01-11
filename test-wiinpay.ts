import { WiinPayService } from './src/lib/wiinpayService';

async function test() {
    console.log("Testing WiinPay Create Payment...");
    try {
        const result = await WiinPayService.createPayment({
            value: 10.00,
            name: "Anônimo",
            email: "user_123456789@telegram.com",
            description: "Pack Exclusivo"
        });
        console.log("Success:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

test();
