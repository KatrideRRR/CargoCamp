
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    CURRENT_OFFER,
} = require("../services/publicOfferConsentService");

const archivePath = path.join(
    __dirname,
    "..",
    "legal",
    `public_offer_${CURRENT_OFFER.version}.txt`
);

test("архив оферты существует и содержит семь разделов", () => {
    const text = fs.readFileSync(archivePath, "utf8");

    for (const section of [
        "1. Стороны и предмет",
        "2. Заказ и роли участников",
        "3. Цена заказа и услуги Платформы",
        "4. Порядок оплаты и выплаты",
        "5. Отмена, возвраты и споры",
        "6. Обращения и данные",
        "7. Действие оферты и реквизиты",
    ]) {
        assert.ok(text.includes(section), section);
    }
});

test("хеш действующей оферты соответствует архиву", () => {
    const text = fs.readFileSync(archivePath, "utf8");

    const hash = crypto
        .createHash("sha256")
        .update(text, "utf8")
        .digest("hex");

    assert.equal(CURRENT_OFFER.sha256, hash);
    assert.equal(CURRENT_OFFER.version, "2026-11-09");
});
