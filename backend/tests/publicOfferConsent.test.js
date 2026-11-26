"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    CURRENT_OFFER,
} = require("../services/publicOfferConsentService");

const offerDocument = require(
    "../../frontend/src/components/PublicOfferDocument.json"
);

const archivePath = path.join(
    __dirname,
    "..",
    "legal",
    `public_offer_${CURRENT_OFFER.version}.txt`
);

test(
    "архив оферты существует и содержит семь разделов",
    () => {
        const text = fs.readFileSync(
            archivePath,
            "utf8"
        );

        for (const section of [
            "1. Стороны и предмет",
            "2. Заказ и роли участников",
            "3. Цена заказа и услуги Платформы",
            "4. Порядок оплаты и выплаты",
            "5. Отмена, возвраты и споры",
            "6. Обращения и данные",
            "7. Действие оферты и реквизиты",
        ]) {
            assert.ok(
                text.includes(section),
                section
            );
        }

        assert.equal(
            offerDocument.sections.length,
            7
        );
    }
);

test(
    "хеш действующей оферты соответствует архиву",
    () => {
        const text = fs.readFileSync(
            archivePath,
            "utf8"
        );

        const hash = crypto
            .createHash("sha256")
            .update(text, "utf8")
            .digest("hex");

        assert.equal(
            CURRENT_OFFER.sha256,
            hash
        );

        assert.equal(
            CURRENT_OFFER.version,
            "2026-11-09"
        );

        assert.equal(
            offerDocument.version,
            CURRENT_OFFER.version
        );

        assert.equal(
            offerDocument.sha256,
            hash
        );
    }
);

test(
    "текст фронтенда точно совпадает с архивом",
    () => {
        assert.equal(
            offerDocument.title,
            "Публичная оферта CargoCamp"
        );

        assert.equal(
            offerDocument.edition,
            "Редакция от 9 ноября 2026 года"
        );

        assert.equal(
            offerDocument.effectiveDate,
            "Дата начала действия: 12 ноября 2026 года"
        );

        const renderedText = [
            offerDocument.title,
            offerDocument.edition,
            offerDocument.effectiveDate,
            "",
            ...offerDocument.sections.flatMap(
                (section) => [
                    section.title,
                    "",
                    ...section.paragraphs.flatMap(
                        (paragraph) => [
                            paragraph,
                            "",
                        ]
                    ),
                ]
            ),
        ].join("\n");

        const archivedText = fs.readFileSync(
            archivePath,
            "utf8"
        );

        assert.equal(
            renderedText,
            archivedText.replace(/\r\n/g, "\n")
        );
    }
);