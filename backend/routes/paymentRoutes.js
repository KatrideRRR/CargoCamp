const express = require('express');
const axios = require('axios');
const router = express.Router();
const Payment = require('../models/Order'); // Подключи свою модель
const crypto = require('crypto');

// Константы
const TINKOFF_API_URL = 'https://securepay.tinkoff.ru/v2/Init';
const TINKOFF_CONFIRM_URL = 'https://securepay.tinkoff.ru/v2/Confirm';
const TINKOFF_STATUS_API_URL = 'https://securepay.tinkoff.ru/v2/GetState';
const TINKOFF_TERMINAL_KEY = 'TinkoffBankTest'; // Замените на реальный ключ
const TINKOFF_PASSWORD = 'TestPassword'; // Замените на реальный пароль
const SUCCESS_URL = 'https://yourwebsite.com/success';
const FAIL_URL = 'https://yourwebsite.com/fail';

// Функция для подписи запросов (если нужна)
function generateToken(paymentData) {
    let tokenString = Object.keys(paymentData)
        .sort()
        .map(key => paymentData[key])
        .join('');

    return crypto.createHash('sha256').update(tokenString + TINKOFF_SECRET_KEY).digest('hex');
}


// Маршрут для создания платежа
router.post('/create', async (req, res) => {
    let { proposedSum, orderId, description, paymentType } = req.body;

    try {
        if (!proposedSum || !orderId || !description || !paymentType) {
            return res.status(400).json({ success: false, message: "Отсутствуют обязательные параметры" });
        }

        let commission = 0;
        switch (paymentType) {
            case 'cash':
                commission = 200;
                break;
            case 'guarantee':
                commission = Math.round(proposedSum * 0.05);
                proposedSum += commission;
                break;
            case 'installment':
                commission = Math.round(proposedSum * 0.07);
                proposedSum += commission;
                break;
            default:
                return res.status(400).json({ success: false, message: "Неверный тип оплаты" });
        }

        const paymentData = {
            TerminalKey: TINKOFF_TERMINAL_KEY,
            Amount: proposedSum * 100,
            OrderId: orderId,
            Description: description,
            SuccessURL: SUCCESS_URL,
            FailURL: FAIL_URL,
            PayType: "O"
        };

        paymentData.Token = generateToken(paymentData);
        const response = await axios.post(TINKOFF_API_URL, paymentData, { headers: { 'Content-Type': 'application/json' } });

        const { Success, ErrorCode, Message, PaymentURL, PaymentId } = response.data;

        if (Success) {
            await Payment.create({ orderId, paymentId: PaymentId, proposedSum, paymentType, isConfirmed: false });
            return res.json({ success: true, paymentUrl: PaymentURL });
        } else {
            return res.json({ success: false, errorCode: ErrorCode, message: Message });
        }
    } catch (error) {
        console.error('Ошибка при создании платежа:', error);
        res.status(500).json({ success: false, message: 'Ошибка при создании платежа' });
    }
});

// Подтверждение платежа
router.post('/confirm', async (req, res) => {
    const { orderId, confirmedBy } = req.body;

    if (!orderId || !confirmedBy) {
        return res.status(400).json({ success: false, message: 'Недостаточно данных' });
    }

    try {
        const payment = await Payment.findOne({ orderId });
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Платеж не найден' });
        }

        if (confirmedBy === 'executor') {
            payment.executorConfirmed = true;
        } else if (confirmedBy === 'customer') {
            payment.customerConfirmed = true;
        }

        if (payment.executorConfirmed && payment.customerConfirmed) {
            if (payment.isConfirmed) {
                return res.json({ success: true, message: 'Платеж уже был подтвержден' });
            }

            const captureResponse = await axios.post(TINKOFF_CONFIRM_URL, {
                TerminalKey: TINKOFF_TERMINAL_KEY,
                PaymentId: payment.paymentId,
                Amount: payment.amount * 100
            });

            if (captureResponse.data.Success) {
                payment.isConfirmed = true;
                await payment.save();
                return res.json({ success: true, message: 'Деньги успешно списаны' });
            } else {
                return res.status(400).json({ success: false, message: 'Ошибка при списании денег' });
            }
        }

        await payment.save();
        res.json({ success: true, message: 'Подтверждение получено' });

    } catch (error) {
        console.error('Ошибка при подтверждении заказа:', error);
        res.status(500).json({ success: false, message: 'Ошибка при подтверждении заказа' });
    }
});

// Проверка статуса платежа
router.post('/status', async (req, res) => {
    const { paymentId, orderId } = req.body;

    try {
        const paymentStatusData = {
            TerminalKey: TINKOFF_TERMINAL_KEY,
            PaymentId: paymentId,
            OrderId: orderId,
        };

        const response = await axios.post(TINKOFF_STATUS_API_URL, paymentStatusData, { headers: { 'Content-Type': 'application/json' } });

        const { Success, ErrorCode, Message, Status } = response.data;

        if (Success) {
            const paymentInfo = await Payment.findOne({ orderId });

            res.json({
                success: true,
                status: Status,
                orderId: paymentInfo.orderId,
                amount: paymentInfo.amount,
                paymentType: paymentInfo.paymentType,
                confirmed: paymentInfo.isConfirmed,
                executorConfirmed: paymentInfo.executorConfirmed,
                customerConfirmed: paymentInfo.customerConfirmed,
            });

        } else {
            res.json({ success: false, errorCode: ErrorCode, message: Message });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ошибка при проверке статуса платежа' });
    }
});

// Вебхук от Тинькофф
router.post('/webhook', async (req, res) => {
    try {
        console.log('Получен вебхук от Тинькофф:', req.body);

        const { Success, Status, OrderId, PaymentId, ErrorCode } = req.body;

        if (!Success) {
            console.error(`Ошибка платежа ${OrderId}: ${ErrorCode}`);
            return res.status(400).json({ success: false });
        }

        const payment = await Payment.findOne({ orderId: OrderId });
        if (!payment) {
            console.error(`Платеж ${OrderId} не найден в базе`);
            return res.status(404).json({ success: false });
        }

        if (Status === 'CONFIRMED') {
            payment.isConfirmed = true;
            await payment.save();
            console.log(`Платеж ${OrderId} успешно подтвержден`);
        } else if (Status === 'CANCELED' || Status === 'REVERSED') {
            payment.status = 'canceled';
            await payment.save();
            console.log(`Платеж ${OrderId} отменен`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка обработки вебхука:', error);
        res.status(500).json({ success: false });
    }
});

router.post('/bind-card', async (req, res) => {
    const { cardNumber } = req.body;

    if (!cardNumber) {
        return res.status(400).json({ success: false, message: "Введите номер карты" });
    }

    try {
        const userId = req.user.id; // Получаем ID пользователя

        await User.update(
            { cardNumber },
            { where: { id: userId } }
        );

        res.json({ success: true, message: "Карта привязана" });
    } catch (error) {
        console.error("Ошибка при привязке карты:", error);
        res.status(500).json({ success: false, message: "Ошибка на сервере" });
    }
});

router.post('/cancel', async (req, res) => {
    const { orderId } = req.body;

    if (!orderId) {
        return res.status(400).json({ success: false, message: "Нужно указать ID заказа" });
    }

    try {
        const order = await Payment.findOne({ where: { orderId } });

        if (!order) {
            return res.status(404).json({ success: false, message: "Заказ не найден" });
        }

        if (order.status !== "PAID") {
            return res.status(400).json({ success: false, message: "Заказ не оплачен, отмена невозможна" });
        }

        // Отправляем запрос в Тинькофф на возврат
        const refundResponse = await fetch("https://securepay.tinkoff.ru/v2/Cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                TerminalKey: process.env.TINKOFF_TERMINAL_KEY,
                Password: process.env.TINKOFF_PASSWORD,
                PaymentId: order.paymentId, // ID платежа в Тинькофф
                Amount: order.amount // Сумма возврата
            })
        });

        const refundData = await refundResponse.json();

        if (!refundData.Success) {
            return res.status(500).json({ success: false, message: "Ошибка при возврате средств" });
        }

        // Обновляем статус заказа в БД
        await order.update({ status: "CANCELLED" });

        res.json({ success: true, message: "Заказ отменен, деньги возвращены" });

    } catch (error) {
        console.error("Ошибка при отмене платежа:", error);
        res.status(500).json({ success: false, message: "Ошибка на сервере" });
    }
});

module.exports = router;
