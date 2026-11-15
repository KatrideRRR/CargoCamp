
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const operationalMonitor = require(
    "../services/operationalErrorMonitor"
);

test(
    "Telegram transport redacts secrets and never calls real API",
    async () => {
        const originalSecret =
            process.env.CARGOCAMP_NOTIFY_SECRET;

        const originalUrl =
            process.env.CARGOCAMP_NOTIFY_URL;

        const calls = [];

        const service = loadIsolatedService(
            "adminNotificationService.js",
            {
                axios: {
                    async post(url, body, config) {
                        calls.push({
                            url,
                            body,
                            config,
                        });

                        return {
                            data: { success: true },
                        };
                    },
                },

                "./operationalErrorMonitor":
                operationalMonitor,
            }
        );

        try {
            process.env.CARGOCAMP_NOTIFY_SECRET =
                "LOCAL_TEST_SECRET";

            process.env.CARGOCAMP_NOTIFY_URL =
                "https://notify.example.invalid/notify";

            const result =
                await service.sendAdminNotification({
                    topic: "system",
                    title: "password=TITLESECRET",
                    message: "password=BODYSECRET",
                    buttonText: "token=BUTTONSECRET",
                    buttonUrl:
                        "https://admin.cargocamp.ru/support",
                });

            assert.equal(result.success, true);
            assert.equal(calls.length, 1);

            const payload = JSON.stringify(
                calls[0].body
            );

            for (const secret of [
                "TITLESECRET",
                "BODYSECRET",
                "BUTTONSECRET",
            ]) {
                assert.equal(
                    payload.includes(secret),
                    false,
                    `Sensitive value exposed: ${secret}`
                );
            }

            assert.equal(
                calls[0].config.headers.Authorization,
                "Bearer LOCAL_TEST_SECRET"
            );

            const invalid =
                await service.sendAdminNotification({
                    topic: "unknown_topic",
                    title: "Test",
                    message: "Test",
                });

            assert.equal(invalid.skipped, true);
            assert.equal(calls.length, 1);

            delete process.env.CARGOCAMP_NOTIFY_SECRET;

            const missing =
                await service.sendAdminNotification({
                    topic: "system",
                    title: "Test",
                    message: "Test",
                });

            assert.equal(missing.skipped, true);
            assert.equal(calls.length, 1);

        } finally {
            if (originalSecret === undefined) {
                delete process.env.CARGOCAMP_NOTIFY_SECRET;
            } else {
                process.env.CARGOCAMP_NOTIFY_SECRET =
                    originalSecret;
            }

            if (originalUrl === undefined) {
                delete process.env.CARGOCAMP_NOTIFY_URL;
            } else {
                process.env.CARGOCAMP_NOTIFY_URL =
                    originalUrl;
            }
        }
    }
);
