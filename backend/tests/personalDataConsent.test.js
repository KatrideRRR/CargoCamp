"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadService() {
    const source =
        fs.readFileSync(
            path.resolve(
                __dirname,
                "../services/personalDataConsentService.js"
            ),
            "utf8"
        );

    const calls = [];

    const module = {
        exports: {},
    };

    const dependencies = {
        "node:crypto":
            require("node:crypto"),

        "../models": {
            sequelize: {
                async query(sql, options) {
                    calls.push({
                        sql,
                        options,
                    });
                },
            },
        },
    };

    new Function(
        "require",
        "module",
        "exports",
        source
    )(
        (name) => {
            if (
                !Object.prototype.hasOwnProperty.call(
                    dependencies,
                    name
                )
            ) {
                throw new Error(
                    `Unexpected import: ${name}`
                );
            }

            return dependencies[name];
        },
        module,
        module.exports
    );

    return {
        ...module.exports,
        calls,
    };
}

test(
    "согласие содержит версию, текст и SHA-256",
    () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "identity_verification"
            );

        assert.ok(document.text);

        assert.ok(document.version);

        assert.match(
            document.sha256,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "отсутствие явного согласия запрещает обработку",
    () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "identity_verification"
            );

        assert.throws(
            () =>
                h.validateConsent({
                    code:
                    document.code,

                    version:
                    document.version,

                    sha256:
                    document.sha256,

                    confirmed: false,
                }),

            {
                httpStatus: 428,
            }
        );
    }
);

test(
    "устаревшая редакция согласия отклоняется",
    () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "identity_verification"
            );

        assert.throws(
            () =>
                h.validateConsent({
                    code:
                    document.code,

                    version:
                        "old-version",

                    sha256:
                    document.sha256,

                    confirmed: true,
                }),

            {
                httpStatus: 428,
            }
        );
    }
);

test(
    "неверный хеш документа отклоняется",
    () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "pension_verification"
            );

        assert.throws(
            () =>
                h.validateConsent({
                    code:
                    document.code,

                    version:
                    document.version,

                    sha256:
                        "incorrect-hash",

                    confirmed: true,
                }),

            {
                httpStatus: 428,
            }
        );
    }
);

test(
    "валидное согласие принимается",
    () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "pension_verification"
            );

        const validated =
            h.validateConsent({
                code:
                document.code,

                version:
                document.version,

                sha256:
                document.sha256,

                confirmed: true,
            });

        assert.deepEqual(
            validated,
            document
        );
    }
);

test(
    "обычное согласие на инвалидность недоступно",
    () => {
        const h = loadService();

        assert.equal(
            h.getConsentDocument(
                "disability_status"
            ),
            null
        );
    }
);

test(
    "согласие сохраняется в транзакции заявки",
    async () => {
        const h = loadService();

        const document =
            h.getConsentDocument(
                "identity_verification"
            );

        const transaction = {};

        await h.recordConsent({
            req: {
                ip: "127.0.0.1",

                get() {
                    return "test-agent";
                },
            },

            userId: 7,

            document,

            transaction,
        });

        assert.equal(
            h.calls.length,
            1
        );

        const call = h.calls[0];

        assert.equal(
            call.options.transaction,
            transaction
        );

        assert.equal(
            call.options.replacements.userId,
            7
        );

        assert.equal(
            call.options.replacements.sha256,
            document.sha256
        );

        assert.equal(
            call.options.replacements.text,
            document.text
        );
    }
);

test(
    "согласие нельзя сохранить вне транзакции",
    async () => {
        const h = loadService();

        await assert.rejects(
            () =>
                h.recordConsent({
                    userId: 7,

                    document:
                        h.getConsentDocument(
                            "identity_verification"
                        ),
                }),

            /транзакция/
        );

        assert.equal(
            h.calls.length,
            0
        );
    }
);