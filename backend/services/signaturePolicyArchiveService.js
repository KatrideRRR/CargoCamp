
const {
    SignaturePolicyRevision,
} = require("../models");

const {
    sha256,
    validatePolicyRevision,
} = require(
    "../utils/signaturePolicyArchiveIntegrity"
);

function archiveError(message) {
    return Object.assign(
        new Error(message),
        { httpStatus: 503 }
    );
}

function identity(policy) {
    return {
        jurisdiction: policy.jurisdiction,
        policyCode: policy.code,
        policyVersion: policy.version,
    };
}

/*
 * Проверка без записи.
 *
 * Используется всеми маршрутами,
 * связанными с согласием и SMS-подписью.
 */
async function requireArchivedSignaturePolicy(
    policy,
    { transaction = null } = {}
) {
    if (
        !policy ||
        sha256(policy.text) !==
        policy.sha256
    ) {
        throw archiveError(
            "Контрольная сумма правил ПЭП недействительна"
        );
    }

    const archived =
        await SignaturePolicyRevision.findOne({
            where: identity(policy),
            transaction,
        });

    if (
        !validatePolicyRevision(
            archived,
            policy
        )
    ) {
        throw archiveError(
            "Редакция правил ПЭП отсутствует в архиве или изменена"
        );
    }

    return archived;
}

/*
 * Отдельная административная операция.
 *
 * Не вызываем её неявно при каждом GET
 * и не создаём редакцию после того,
 * как пользователь уже нажал согласие.
 */
async function archiveSignaturePolicy(policy) {
    if (
        !policy ||
        sha256(policy.text) !==
        policy.sha256
    ) {
        throw archiveError(
            "Некорректная контрольная сумма редакции"
        );
    }

    const [record, created] =
        await SignaturePolicyRevision.findOrCreate({
            where: identity(policy),

            defaults: {
                policySha256: policy.sha256,
                policyText: policy.text,
                archivedAt: new Date(),
            },
        });

    if (
        !validatePolicyRevision(
            record,
            policy
        )
    ) {
        throw archiveError(
            "Номер редакции уже занят другим текстом. Создайте новую версию."
        );
    }

    return {
        record,
        created,
    };
}

/*
 * Поиск архивной редакции
 * конкретного принятого соглашения.
 *
 * При отсутствии старого текста НЕ
 * восстанавливаем его из текущего:
 * это могло бы создать ложное доказательство.
 */
async function inspectArchivedAgreement(
    agreement
) {
    const record =
        await SignaturePolicyRevision.findOne({
            where: {
                jurisdiction:
                agreement.jurisdiction,

                policyCode:
                agreement.policyCode,

                policyVersion:
                agreement.policyVersion,
            },
        });

    const valid =
        validatePolicyRevision(
            record,
            {
                jurisdiction:
                agreement.jurisdiction,

                code:
                agreement.policyCode,

                version:
                agreement.policyVersion,

                sha256:
                agreement.policySha256,
            }
        );

    return {
        valid,

        archiveId:
            valid
                ? String(record.id)
                : null,

        text:
            valid
                ? record.policyText
                : null,

        sha256:
        agreement.policySha256,
    };
}

module.exports = {
    requireArchivedSignaturePolicy,
    archiveSignaturePolicy,
    inspectArchivedAgreement,
};
