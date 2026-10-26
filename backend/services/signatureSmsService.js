
const axios = require("axios");

const PROVIDER_ERRORS = {
    200: "SMS.ru: неверный API-ключ",
    201: "SMS.ru: недостаточно средств",
    202: "SMS.ru: некорректный номер или нет маршрута",
    204: "SMS.ru: отправитель не подключён к оператору",
    206: "SMS.ru: превышен дневной лимит",
    207: "SMS.ru: доставка на этот номер недоступна",
    220: "SMS.ru: сервис временно недоступен",
    221: "SMS.ru: требуется зарегистрировать отправителя",
    222: "SMS.ru: текст не соответствует разрешённому шаблону",
    230: "SMS.ru: превышен дневной лимит на номер",
    231: "SMS.ru: слишком частые сообщения",
    232: "SMS.ru: превышен лимит повторных сообщений",
    233: "SMS.ru: сработала защита от частых кодов",
    301: "SMS.ru: API-ключ недействителен",
    302: "SMS.ru: аккаунт не подтверждён",
};

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

function providerError(data, recipient) {
    const code = Number(
        recipient?.status_code ??
        data?.status_code ??
        0
    );

    return new Error(
        PROVIDER_ERRORS[code] ||
        "SMS.ru не принял сообщение"
    );
}

async function sendSignatureSms({
                                    phone,
                                    code,
                                    documentNumber,
                                }) {
    const apiId = process.env.SMS_RU_API_ID;

    if (!apiId) {
        throw new Error("SMS_RU_API_ID не настроен");
    }

    const normalizedPhone = normalizePhone(phone);

    if (!/^\d{6}$/.test(String(code))) {
        throw new Error("Некорректный SMS-код");
    }

    const form = new URLSearchParams({
        api_id: apiId,
        to: normalizedPhone,
        msg:
            `CargoCamp: код подписи документа ` +
            `${documentNumber}: ${code}. ` +
            `Никому не сообщайте код.`,
        json: "1",
    });

    // Используем имя отправителя только после
    // его согласования с SMS.ru.
    const sender = String(
        process.env.SMS_RU_SENDER || ""
    ).trim();

    if (sender) {
        if (!/^[A-Za-z0-9]{1,11}$/.test(sender)) {
            throw new Error(
                "Некорректное имя SMS-отправителя"
            );
        }

        form.set("from", sender);
    }

    let response;

    try {
        response = await axios.post(
            "https://sms.ru/sms/send",
            form.toString(),
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
                timeout: 15000,
                maxRedirects: 0,
            }
        );
    } catch (error) {
        // Не выводим в лог axios.config:
        // в теле запроса находятся API-ключ и SMS-код.
        console.error(
            "Signature SMS transport error:",
            error.code || "PROVIDER_UNAVAILABLE"
        );

        throw new Error(
            "Не удалось связаться с SMS.ru"
        );
    }

    const data = response.data;
    const recipient = data?.sms?.[normalizedPhone];

    if (
        data?.status !== "OK" ||
        recipient?.status !== "OK" ||
        Number(recipient.status_code) !== 100
    ) {
        throw providerError(data, recipient);
    }

    // Код 100 означает принятие в очередь SMS.ru,
    // а не подтверждённую доставку пользователю.
    // Подпись создаст только успешный ввод кода.
    return {
        providerReference:
            String(recipient.sms_id || "").slice(0, 191),

        maskedPhone:
            maskPhone(normalizedPhone),
    };
}

module.exports = {
    normalizePhone,
    maskPhone,
    sendSignatureSms,
};
