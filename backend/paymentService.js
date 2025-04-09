const crypto = require("crypto");
const axios = require("axios");

const TERMINAL_KEY = process.env.TERMINAL_KEY;
const PASSWORD = process.env.TINKOFF_PASSWORD;
const API_URL = "https://securepay.tinkoff.ru/v2";

function generateToken(params) {
    delete params.Token;
    const { Receipt, ...paramsWithoutReceipt } = params;
    paramsWithoutReceipt.Password = PASSWORD;

    const sortedKeys = Object.keys(paramsWithoutReceipt).sort();
    const dataString = sortedKeys.map(key => paramsWithoutReceipt[key]).join('');
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    delete paramsWithoutReceipt.Password;
    return hash;
}

async function processPayment(userId, amount) {
    try {
        const params = {
            TerminalKey: TERMINAL_KEY,
            Amount: amount * 100, // В копейках
            OrderId: `test_${userId}_${Date.now()}`,
            Description: "Привязка карты",
            CustomerKey: `user_${userId}`,
            Recurrent: "Y",
            NotificationURL: `https://18.184.43.44:5001/api/payment/callback`, // важен!
            Receipt: {
                Email: "test@example.com",
                Taxation: "usn_income", // Упрощенная система налогообложения (доход)
                Items: [
                    {
                        Name: "Привязка карты",
                        Price: amount * 100,
                        Quantity: 1,
                        Amount: amount * 100,
                        Tax: "none", // Без НДС
                        PaymentMethod: "full_prepayment",
                        PaymentObject: "service",
                    }
                ]
            }
        };

        params.Token = generateToken(params); // Генерируем токен без Receipt

        const response = await axios.post(`${API_URL}/Init`, params);
        console.log("Ответ Тинькофф:", response.data);

        if (response.data.Success) {
            return { success: true, transactionId: response.data.PaymentId };
        }
        return { success: false, message: response.data.Message };
    } catch (error) {
        console.error("Ошибка платежа:", error?.response?.data || error.message);
        return { success: false, message: "Ошибка сервера" };
    }
}

async function refundPayment(transactionId) {
    try {
        const response = await axios.post(`${API_URL}/Cancel`, {
            TerminalKey: TERMINAL_KEY,
            PaymentId: transactionId,
            Password: PASSWORD,
        });

        return response.data.Success ? { success: true } : { success: false, message: response.data.Message };
    } catch (error) {
        console.error("Ошибка возврата платежа:", error);
        return { success: false, message: "Ошибка сервера" };
    }
}

module.exports = { processPayment, refundPayment };
