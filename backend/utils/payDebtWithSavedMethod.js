const { v4: uuidv4 } = require('uuid');
const yooKassa = require('../utils/yookassaClient');

async function tryAutoPayDebtForUser(user) {
    const debtKopecks = Number(user.debt || 0);
    if (debtKopecks <= 0) return { ok: true, skipped: true, reason: 'no_debt' };

    const pmId = user.yookassa_payment_method_id;
    if (!pmId) return { ok: false, skipped: true, reason: 'no_payment_method' };

    const amountValue = (debtKopecks / 100).toFixed(2);
    const idempotenceKey = `auto_debt_${user.id}_${user.commissionDebtOrderId || 'noorder'}`;

    const payment = await yooKassa.createPayment({
        amount: { value: amountValue, currency: 'RUB' },
        capture: true,
        payment_method_id: pmId, // ✅ автосписание
        description: `Автосписание комиссии (задолженность) user #${user.id}`,
        metadata: {
            type: 'debt',
            userId: String(user.id),
            expectedKopecks: String(debtKopecks),
            auto: '1',
        },
        receipt: {
            customer: { phone: String(user.phone || '').replace(/[^\d+]/g, '') },
            items: [{
                description: `Комиссия (автосписание)`,
                quantity: 1,
                amount: { value: amountValue, currency: 'RUB' },
                vat_code: 1,
                payment_mode: 'full_payment',
                payment_subject: 'service',
            }],
            tax_system_code: 2,
        },
    }, idempotenceKey);

    return { ok: true, paymentId: payment.id, status: payment.status };
}

module.exports = { tryAutoPayDebtForUser };