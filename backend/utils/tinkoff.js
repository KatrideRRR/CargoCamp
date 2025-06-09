const axios = require("axios");
const crypto = require("crypto");

function generateToken(params) {
    delete params.Token;
    const { Receipt, ...paramsWithoutReceipt } = params;

    paramsWithoutReceipt.Password = process.env.TINKOFF_PASSWORD;
    const sortedKeys = Object.keys(paramsWithoutReceipt).sort();

    const dataString = sortedKeys.map((key) => paramsWithoutReceipt[key]).join("");
    const hash = crypto.createHash("sha256").update(dataString).digest("hex");

    delete paramsWithoutReceipt.Password;
    return hash;
}

async function createPayment({ amount, orderId, successURL, failURL, notificationURL }) {
    const TerminalKey = process.env.TERMINAL_KEY;

    const payload = {
        TerminalKey,
        Amount: Math.round(amount * 100),
        OrderId: orderId.toString(),
        Description: "Оплата заказа",
        SuccessURL: successURL,
        FailURL: failURL,
        NotificationURL: notificationURL,

        // 👇 Добавь это:
        Receipt: {
            Email: "test@example.com", // желательно email пользователя
            Taxation: "usn_income", // или другой, зависит от твоей настройки в ЛК
            Items: [
                {
                    Name: "Оплата заказа",
                    Price: Math.round(amount * 100),
                    Quantity: 1,
                    Amount: Math.round(amount * 100),
                    Tax: "none", // или "vat10", "vat20" и т.д.
                    PaymentMethod: "full_prepayment",
                    PaymentObject: "service",
                }
            ]
        }
    };


    payload.Token = generateToken(payload);

    const response = await axios.post("https://securepay.tinkoff.ru/v2/Init", payload);

    console.log(response.data)

    if (response.data.Success) {
        return response.data.PaymentURL;
    } else {
        throw new Error(response.data.Message || 'Ошибка при создании платежа');
    }
}

module.exports = {
    createPayment,
    generateToken,
};
