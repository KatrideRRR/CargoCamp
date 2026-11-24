"use strict";

// Первая публичная версия: оплата работы напрямую.
// Не включать guarantee/installment без отдельного
// согласования, разработки и релизных тестов.
function isLaunchPaymentTypeAllowed(paymentType) {
    return paymentType === "cash";
}

module.exports = {
    isLaunchPaymentTypeAllowed,
};
