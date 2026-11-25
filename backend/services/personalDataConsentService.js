"use strict";

const crypto = require("node:crypto");
const { sequelize } = require("../models");

const VERSION = "2026-11-25";

const DOCUMENTS = Object.freeze({
    identity_verification: {
        version: VERSION,

        text: [
            "Согласие на обработку персональных данных",
            "для проверки личности.",
            "",
            "Оператор: ИП Аджиаметов Аким Ибришевич,",
            "ИНН 910908457603,",
            "Республика Крым, г. Симферополь,",
            "ул. Балаклавская, 39.",
            "",
            "Я добровольно соглашаюсь на обработку",
            "предоставленных мной сведений и документов",
            "для проверки моей личности в CargoCamp.",
            "",
            "Цель обработки — установление личности",
            "и рассмотрение заявки на верификацию.",
            "",
            "Обработка включает получение, запись,",
            "хранение, проверку, использование,",
            "уточнение, блокирование и уничтожение",
            "предоставленных данных.",
            "",
            "Данные могут обрабатываться",
            "уполномоченными лицами оператора.",
            "",
            "Документы не предназначены для",
            "публичного распространения.",
            "",
            "Согласие действует до достижения цели",
            "обработки или его отзыва.",
            "",
            "Отозвать согласие можно посредством",
            "обращения на partner@cargocamp.ru.",
        ].join("\n"),
    },

    pension_verification: {
        version: VERSION,

        text: [
            "Согласие на обработку персональных данных",
            "для подтверждения пенсионной льготы.",
            "",
            "Оператор: ИП Аджиаметов Аким Ибришевич,",
            "ИНН 910908457603,",
            "Республика Крым, г. Симферополь,",
            "ул. Балаклавская, 39.",
            "",
            "Я добровольно предоставляю сведения",
            "о своём праве на пенсионную льготу",
            "и подтверждающий документ для их проверки.",
            "",
            "Цель обработки — проверка права",
            "на льготные условия CargoCamp.",
            "",
            "Согласие не распространяется на",
            "обработку сведений о состоянии здоровья.",
            "",
            "Обработка включает получение, запись,",
            "хранение, проверку, использование,",
            "блокирование и уничтожение данных.",
            "",
            "Согласие действует до достижения цели",
            "обработки или его отзыва.",
            "",
            "Отозвать согласие можно посредством",
            "обращения на partner@cargocamp.ru.",
        ].join("\n"),
    },
});

function getConsentDocument(code) {
    const document = Object.prototype
        .hasOwnProperty.call(
            DOCUMENTS,
            code
        )
        ? DOCUMENTS[code]
        : null;

    if (!document) return null;

    return {
        code,

        version: document.version,

        text: document.text,

        sha256: crypto
            .createHash("sha256")
            .update(document.text, "utf8")
            .digest("hex"),
    };
}

function consentError(message) {
    const error = new Error(message);

    error.httpStatus = 428;

    return error;
}

function validateConsent({
                             code,
                             version,
                             sha256,
                             confirmed,
                         }) {
    const document =
        getConsentDocument(code);

    if (!document) {
        throw consentError(
            "Неизвестный документ согласия"
        );
    }

    if (confirmed !== true) {
        throw consentError(
            "Необходимо отдельное согласие"
        );
    }

    if (
        version !== document.version ||
        sha256 !== document.sha256
    ) {
        throw consentError(
            "Редакция согласия изменилась"
        );
    }

    return document;
}

async function recordConsent({
                                 req,
                                 userId,
                                 document,
                                 transaction,
                             }) {
    if (!transaction) {
        throw new Error(
            "Для сохранения согласия нужна транзакция"
        );
    }

    await sequelize.query(
        `
        INSERT INTO personal_data_consents (
            user_id,
            consent_code,
            consent_version,
            consent_sha256,
            consent_text,
            ip_address,
            user_agent
        )
        VALUES (
            :userId,
            :code,
            :version,
            :sha256,
            :text,
            :ipAddress,
            :userAgent
        )
        `,
        {
            replacements: {
                userId,

                code: document.code,

                version: document.version,

                sha256: document.sha256,

                text: document.text,

                ipAddress:
                    String(req.ip || "")
                        .slice(0, 64),

                userAgent:
                    String(
                        req.get("user-agent") || ""
                    ).slice(0, 2048),
            },

            transaction,
        }
    );
}

module.exports = {
    getConsentDocument,
    validateConsent,
    recordConsent,
};