"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.resolve(
        __dirname,
        "../routes/orderCompletionFlow.js"
    ),
    "utf8"
);

test(
    "Маршрутизатор завершения заказов не блокирует чужие публичные маршруты",
    () => {
        assert.doesNotMatch(
            source,
            /router\s*\.\s*use\s*\(\s*authenticateToken\b/
        );
    }
);

const protectedRoutes = [
    ["post", "/complete/:id"],
    ["post", "/:id/corrections/submit"],
    ["post", "/:id/corrections/review"],
    ["post", "/:id/ensure-completion-act"],
    ["get", "/pending-act-signatures"],
];

for (const [method, route] of protectedRoutes) {
    test(
        `${method.toUpperCase()} ${route} требует авторизацию`,
        () => {
            const escapedRoute = route.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

            const pattern = new RegExp(
                `router\\s*\\.\\s*${method}\\s*\\(` +
                `\\s*["']${escapedRoute}["']\\s*,` +
                `\\s*authenticateToken\\s*,`
            );

            assert.match(source, pattern);
        }
    );
}

test(
    "Маршрут заказов импортирует buildOrderContractDetails",
    () => {
        const ordersSource = fs.readFileSync(
            path.resolve(
                __dirname,
                "../routes/orders.js"
            ),
            "utf8"
        );

        assert.match(
            ordersSource,
            /const\s*\{\s*buildOrderContractDetails\s*,?\s*\}\s*=\s*require\(["']\.\.\/services\/orderContractDetailsService["']\)/
        );
    }
);