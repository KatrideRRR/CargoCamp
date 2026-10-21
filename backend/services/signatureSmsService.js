
const axios = require("axios");

function normalizePhone(value) {
    let phone = String(value || "").replace(/\D/g, "");

    if (/^8\d{10}$/.test(phone)) {
        phone = `7${phone.slice(1)}`;
    }

    if (!/^7\d{10}$/.test(phone)) {
        throw new Error("Некорректный номер телефона");
    }

    return phone;
}

function maskPhone(phone) {
    return `+7 *** ***-${phone.slice(-4)}`;
}

async function sendSignatureSms({
                                    phone,
                                    code,
                                    documentNumber,
                                }) {
    const apiId = process.env.SMS_RU_API_ID;

    if (!apiId) {
        throw new Error("SMS-провайдер не настроен");
    }

    const normalizedPhone = normalizePhone(phone);

    const form = new URLSearchParams({
        api_id: apiId,
        to: normalizedPhone,
        msg:
            `CargoCamp: код подписи документа ` +
            `${documentNumber}: ${code}. ` +
            `Никому не сообщайте код.`,
        json: "1",
    });

    const response = await axios.post(
        "https://sms.ru/sms/send",
        form.toString(),
        {
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded",
            },
            timeout: 15000,
        }
    );

    const data = response.data;
    const recipient = data?.sms?.[normalizedPhone];

    if (
        data?.status !== "OK" ||
        recipient?.status !== "OK" ||
        Number(recipient?.status_code) !== 100
    ) {
        throw new Error(
            "SMS-провайдер не принял сообщение"
        );
    }

    return {
        providerReference:
            String(recipient.sms_id || "").slice(0, 191),
        maskedPhone: maskPhone(normalizedPhone),
    };
}

module.exports = {
    normalizePhone,
    maskPhone,
    sendSignatureSms,
};
