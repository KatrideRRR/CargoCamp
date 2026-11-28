import { expect } from "@playwright/test";

export async function mockDebtPayment(
    page,
    {
        provider = "yookassa",
        orderId = 101,
        amountKopecks = 25000,
        intentId = 9001,
        initialStatus = "pending",
        requestStatus = "sent",
    } = {}
) {
    const calls = {
        create: 0,
        reconcile: 0,
        directRequest: 0,
        bodies: [],
    };

    let confirmed = false;

    const paymentState = () => ({
        success: true,
        intentId,
        provider,
        orderId,
        amountKopecks,

        paymentId: "isolated-test-payment",

        paymentStatus: confirmed
            ? "succeeded"
            : initialStatus,

        requestStatus: confirmed
            ? requestStatus
            : "pending",

        requestError:
            confirmed && requestStatus === "failed"
                ? "Заказ уже недоступен"
                : null,

        confirmationUrl: null,

        paidBySavedCard: true,

        paymentProcessing: !confirmed,

        paid: confirmed,

        noDebt: false,
    });

    await page.route(
        "**/api/payments/debt/intent/active",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    intent: null,
                },
            });
        }
    );

    const endpoint =
        provider === "tbank"
            ? "tbank-payments"
            : "payments";

    await page.route(
        `**/api/${endpoint}/debt/intent/create`,
        async (route) => {
            expect(
                route.request().method()
            ).toBe("POST");

            calls.create++;

            calls.bodies.push(
                route.request().postDataJSON()
            );

            await route.fulfill({
                status: 200,
                json: paymentState(),
            });
        }
    );

    await page.route(
        `**/api/payments/debt/intent/${intentId}`,
        async (route) => {
            await route.fulfill({
                status: 200,
                json: paymentState(),
            });
        }
    );

    await page.route(
        `**/api/payments/debt/intent/${intentId}/reconcile`,
        async (route) => {
            expect(
                route.request().method()
            ).toBe("POST");

            calls.reconcile++;

            await route.fulfill({
                status: 200,
                json: paymentState(),
            });
        }
    );

    // Новый клиент не должен самостоятельно
    // отправлять отклик после оплаты.

    await page.route(
        `**/api/orders/${orderId}/request`,
        async (route) => {
            calls.directRequest++;

            await route.fulfill({
                status: 409,
                json: {
                    message:
                        "Unexpected direct request",
                },
            });
        }
    );

    return {
        calls,

        confirm() {
            confirmed = true;
        },

        paymentState,
    };
}