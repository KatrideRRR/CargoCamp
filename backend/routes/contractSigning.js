
const express = require("express");
const crypto = require("crypto");
const { Op } = require("sequelize");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    getCurrentVerifiedIdentity,
} = require("../services/identityStatusService");

const {
    sequelize,
    User,
    Order,
    Contract,
    ContractSignature,
    ContractEvent,
    SignatureChallenge,
    IdentityVerification,
    ElectronicSignatureAgreement,
    ActionLog,
} = require("../models");

const {
    requireArchivedSignaturePolicy,
} = require(
    "../services/signaturePolicyArchiveService"
);

const { getSignaturePolicy } =
    require("../config/signaturePolicy");

const { assertVerifiedPdfIntegrity } =
    require("../services/verifiedPdfIntegrity");

const {
    normalizePhone,
    maskPhone,
    sendSignatureSms,
} = require("../services/signatureSmsService");

const router = express.Router();

const TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS = 3;
const MAX_ATTEMPTS = 5;

router.use(authenticateToken);

router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

function fail(status, message) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

function respondError(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            success: false,
            message: error.message,
        });
    }

    console.error("Contract signing error:", error);

    return res.status(500).json({
        success: false,
        message: "Ошибка обработки подписи",
    });
}

function getSecret() {
    const value = process.env.SIGNATURE_OTP_SECRET_HEX;

    if (!/^[0-9a-f]{64}$/i.test(value || "")) {
        throw fail(503, "Сервис подписания не настроен");
    }

    return Buffer.from(value, "hex");
}

function signingEnabled() {
    const policy = getSignaturePolicy();

    return (
        policy.enabled &&
        process.env.CARGOCAMP_SIGNATURE_SMS_ENABLED ===
        "true"
    );
}

function requireSigningEnabled() {
    if (!signingEnabled()) {
        throw fail(
            503,
            "Электронное подписание пока не включено"
        );
    }

    getSecret();

    if (!process.env.SMS_RU_API_ID) {
        throw fail(503, "SMS-провайдер не настроен");
    }
}

function hmac(value) {
    return crypto
        .createHmac("sha256", getSecret())
        .update(value)
        .digest("hex");
}

function safeHashEqual(a, b) {
    if (
        !/^[a-f0-9]{64}$/i.test(String(a || "")) ||
        !/^[a-f0-9]{64}$/i.test(String(b || ""))
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(a, "hex"),
        Buffer.from(b, "hex")
    );
}

function codeHash({
                      contractId,
                      userId,
                      documentHash,
                      salt,
                      code,
                  }) {
    return hmac(
        [
            contractId,
            userId,
            documentHash,
            salt,
            code,
        ].join(":")
    );
}

function getIp(req) {
    return String(
        req.socket.remoteAddress || ""
    ).slice(0, 64) || null;
}

function getUa(req) {
    return String(
        req.get("user-agent") || ""
    ).slice(0, 1000) || null;
}

async function getContext(id, userId, transaction, lock) {
    const contract = await Contract.findByPk(id, {
        transaction,
        ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });

    if (
        !contract ||
        contract.type !== "verified_assignment"
    ) {
        throw fail(404, "Договор не найден");
    }

    const order = await Order.findByPk(
        contract.orderId,
        { transaction }
    );

    if (!order) {
        throw fail(404, "Договор не найден");
    }

    const creatorId = Number(order.creatorId);
    const executorId = Number(order.executorId);

    if (
        userId !== creatorId &&
        userId !== executorId
    ) {
        throw fail(404, "Договор не найден");
    }

    return {
        contract,
        order,
        partyRole:
            userId === creatorId
                ? "creator"
                : "executor",
    };
}

async function activeIdentity(
    userId,
    transaction
) {
    return getCurrentVerifiedIdentity(
        userId,
        { transaction }
    );
}

async function prerequisites(ctx, userId, transaction) {
    const policy = getSignaturePolicy();

    await requireArchivedSignaturePolicy(
        policy,
        { transaction }
    );

    const [customerIdentity, executorIdentity, agreement] =
        await Promise.all([
            activeIdentity(ctx.order.creatorId, transaction),
            activeIdentity(ctx.order.executorId, transaction),
            ElectronicSignatureAgreement.findOne({
                where: {
                    userId,
                    jurisdiction: policy.jurisdiction,
                    policyCode: policy.code,
                    policyVersion: policy.version,
                },
                transaction,
            }),
        ]);

    if (!customerIdentity || !executorIdentity) {
        throw fail(
            403,
            "Подтверждение личности одной из сторон недействительно"
        );
    }

    if (
        !agreement ||
        !safeHashEqual(
            agreement.policySha256,
            policy.sha256
        )
    ) {
        throw fail(
            403,
            "Необходимо принять действующие правила электронной подписи"
        );
    }

    return {
        policy,
        agreement,
        identity:
            ctx.partyRole === "creator"
                ? customerIdentity
                : executorIdentity,
    };
}

function requireUnsigned(contract) {

    if (
        !["2", "3"].includes(
            String(contract.templateVersion)
        )
    ) {
        throw fail(
            409,
            "Для этого договора требуется новая версия документа"
        );
    }

    if (
        !["draft", "partially_signed"].includes(
            contract.status
        ) ||
        contract.fullySignedAt ||
        contract.supersededAt
    ) {
        throw fail(
            409,
            "Документ больше не доступен для подписания"
        );
    }
}

/*
 * GET /api/contracts/signing/:contractId/status
 */
router.get("/:contractId/status", async (req, res) => {
    try {
        const userId = Number(req.user.id);

        const ctx = await getContext(
            req.params.contractId,
            userId
        );

        const signatures = await ContractSignature.findAll({
            where: { contractId: ctx.contract.id },
            attributes: ["userId", "signedAt"],
        });

        const mySigned = signatures.some(
            (item) => Number(item.userId) === userId
        );

        const otherSigned = signatures.some(
            (item) =>
                Number(item.userId) !== userId
        );

        const currentUser = await User.findByPk(userId, {
            attributes: ["phone"],
        });

        let phone = null;

        try {
            phone = normalizePhone(currentUser?.phone);
        } catch {
            // Некорректный номер блокирует подписание.
        }

        const policy = getSignaturePolicy();

        await requireArchivedSignaturePolicy(
            policy
        );

        const agreement =
            await ElectronicSignatureAgreement.findOne({
                where: {
                    userId,
                    jurisdiction: policy.jurisdiction,
                    policyCode: policy.code,
                    policyVersion: policy.version,
                },
            });

        const accepted = Boolean(agreement) &&
            safeHashEqual(
                agreement.policySha256,
                policy.sha256
            );

        const identities = await Promise.all([
            activeIdentity(ctx.order.creatorId),
            activeIdentity(ctx.order.executorId),
        ]);

        const identitiesValid =
            identities.every(Boolean);

        const enabled =
            signingEnabled() &&
            Boolean(process.env.SMS_RU_API_ID) &&
            /^[a-f0-9]{64}$/i.test(
                process.env.SIGNATURE_OTP_SECRET_HEX || ""
            );

        const pending = await SignatureChallenge.findOne({
            where: {
                contractId: ctx.contract.id,
                userId,
                status: "pending",
                expiresAt: { [Op.gt]: new Date() },
            },
            order: [["createdAt", "DESC"]],
            attributes: [
                "id",
                "expiresAt",
                "recipientMasked",
            ],
        });

        return res.json({
            success: true,
            enabled,
            accepted,
            identitiesValid,
            mySigned,
            otherSigned,
            contractStatus: ctx.contract.status,
            maskedPhone: phone ? maskPhone(phone) : null,
            canSign:
                enabled &&
                accepted &&
                identitiesValid &&
                Boolean(phone) &&
                ["2", "3"].includes(
                    String(ctx.contract.templateVersion)
                ) &&
                ["draft", "partially_signed"].includes(
                    ctx.contract.status
                ) &&
                !ctx.contract.supersededAt,

            pendingChallenge: pending
                ? {
                    id: pending.id,
                    expiresAt: pending.expiresAt,
                    maskedPhone: pending.recipientMasked,
                }
                : null,
        });

    } catch (error) {
        return respondError(res, error);
    }
});

/*
 * POST /api/contracts/signing/:contractId/request-code
 *
 * {
 *   documentHash: "...",
 *   intentConfirmed: true
 * }
 */
router.post("/:contractId/request-code", async (req, res) => {
    try {
        requireSigningEnabled();

        if (req.body?.intentConfirmed !== true) {
            throw fail(
                400,
                "Подтвердите намерение подписать документ"
            );
        }

        const userId = Number(req.user.id);

        const existingCtx = await getContext(
            req.params.contractId,
            userId
        );

        requireUnsigned(existingCtx.contract);

        if (
            !safeHashEqual(
                req.body?.documentHash,
                existingCtx.contract.documentHash
            )
        ) {
            throw fail(
                409,
                "Версия PDF изменилась. Обновите карточку."
            );
        }

        await assertVerifiedPdfIntegrity(
            existingCtx.contract
        );

        const code = String(
            crypto.randomInt(100000, 1000000)
        );

        const prepared = await sequelize.transaction(
            async (transaction) => {
                // Сериализуем отправки одного пользователя.
                const user = await User.findByPk(userId, {
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                if (!user) {
                    throw fail(401, "Пользователь не найден");
                }

                const phone = normalizePhone(user.phone);

                const ctx = await getContext(
                    req.params.contractId,
                    userId,
                    transaction,
                    true
                );

                requireUnsigned(ctx.contract);

                if (
                    !safeHashEqual(
                        existingCtx.contract.documentHash,
                        ctx.contract.documentHash
                    )
                ) {
                    throw fail(409, "Документ изменился");
                }

                const prereq = await prerequisites(
                    ctx,
                    userId,
                    transaction
                );

                const priorSignature =
                    await ContractSignature.findOne({
                        where: {
                            contractId: ctx.contract.id,
                            userId,
                        },
                        transaction,
                    });

                if (priorSignature) {
                    throw fail(409, "Вы уже подписали документ");
                }

                const now = new Date();

                const lastAttempt =
                    await SignatureChallenge.findOne({
                        where: {
                            userId,
                            createdAt: {
                                [Op.gte]: new Date(
                                    now.getTime() - COOLDOWN_MS
                                ),
                            },
                        },
                        order: [["createdAt", "DESC"]],
                        transaction,
                    });

                if (lastAttempt) {
                    throw fail(
                        429,
                        "Повторная отправка возможна через минуту"
                    );
                }

                const fingerprint = hmac(`phone:${phone}`);

                const sendCount =
                    await SignatureChallenge.count({
                        where: {
                            recipientFingerprint: fingerprint,
                            createdAt: {
                                [Op.gte]: new Date(
                                    now.getTime() - WINDOW_MS
                                ),
                            },
                        },
                        transaction,
                    });

                if (sendCount >= MAX_SENDS) {
                    throw fail(
                        429,
                        "Превышен лимит SMS. Повторите позже."
                    );
                }

                await SignatureChallenge.update(
                    { status: "superseded" },
                    {
                        where: {
                            contractId: ctx.contract.id,
                            userId,
                            status: {
                                [Op.in]: ["pending", "sending"],
                            },
                        },
                        transaction,
                    }
                );

                const salt =
                    crypto.randomBytes(16).toString("hex");

                const challenge =
                    await SignatureChallenge.create(
                        {
                            contractId: ctx.contract.id,
                            userId,
                            agreementId: prereq.agreement.id,
                            partyRole: ctx.partyRole,
                            method: "otp_sms",
                            documentHash:
                            ctx.contract.documentHash,
                            codeSalt: salt,
                            codeHash: codeHash({
                                contractId: ctx.contract.id,
                                userId,
                                documentHash:
                                ctx.contract.documentHash,
                                salt,
                                code,
                            }),
                            recipientFingerprint: fingerprint,
                            recipientMasked: maskPhone(phone),
                            status: "sending",
                            attemptsCount: 0,
                            maxAttempts: MAX_ATTEMPTS,
                            expiresAt: new Date(
                                now.getTime() + TTL_MS
                            ),
                            ipAddress: getIp(req),
                            userAgent: getUa(req),
                        },
                        { transaction }
                    );

                return {
                    challengeId: challenge.id,
                    phone,
                    documentNumber:
                    ctx.contract.documentNumber,
                };
            }
        );

        try {
            const sent = await sendSignatureSms({
                phone: prepared.phone,
                code,
                documentNumber: prepared.documentNumber,
            });

            const [updated] = await SignatureChallenge.update(
                {
                    status: "pending",
                    providerReference:
                    sent.providerReference,
                },
                {
                    where: {
                        id: prepared.challengeId,
                        status: "sending",
                    },
                }
            );

            if (updated !== 1) {
                throw fail(
                    409,
                    "Запрос подтверждения уже неактуален"
                );
            }

            return res.json({
                success: true,
                challengeId: prepared.challengeId,
                maskedPhone: sent.maskedPhone,
                expiresInSec: TTL_MS / 1000,
            });

        } catch (sendError) {
            await SignatureChallenge.update(
                { status: "failed" },
                {
                    where: {
                        id: prepared.challengeId,
                        status: "sending",
                    },
                }
            );

            throw fail(
                502,
                "Не удалось отправить SMS для подписания"
            );
        }

    } catch (error) {
        return respondError(res, error);
    }
});

/*
 * POST /api/contracts/signing/:contractId/confirm-code
 *
 * {
 *   challengeId: 123,
 *   code: "123456",
 *   documentHash: "..."
 * }
 */
router.post("/:contractId/confirm-code", async (req, res) => {
    try {
        requireSigningEnabled();

        const userId = Number(req.user.id);
        const code = String(req.body?.code || "");

        if (!/^\d{6}$/.test(code)) {
            throw fail(400, "Введите шестизначный SMS-код");
        }

        const challengeId = Number(req.body?.challengeId);

        if (
            !Number.isSafeInteger(challengeId) ||
            challengeId <= 0
        ) {
            throw fail(400, "Некорректный запрос подписи");
        }

        const ctxBefore = await getContext(
            req.params.contractId,
            userId
        );

        requireUnsigned(ctxBefore.contract);

        if (
            !safeHashEqual(
                req.body?.documentHash,
                ctxBefore.contract.documentHash
            )
        ) {
            throw fail(409, "Документ изменился");
        }

        await assertVerifiedPdfIntegrity(
            ctxBefore.contract
        );

        const result = await sequelize.transaction(
            async (transaction) => {
                const ctx = await getContext(
                    req.params.contractId,
                    userId,
                    transaction,
                    true
                );

                requireUnsigned(ctx.contract);

                const challenge =
                    await SignatureChallenge.findOne({
                        where: {
                            id: challengeId,
                            contractId: ctx.contract.id,
                            userId,
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                if (
                    !challenge ||
                    challenge.status !== "pending"
                ) {
                    return {
                        httpStatus: 409,
                        message:
                            "Запрос подписи неактивен",
                    };
                }

                const now = new Date();

                if (new Date(challenge.expiresAt) <= now) {
                    challenge.status = "expired";
                    await challenge.save({ transaction });

                    return {
                        httpStatus: 410,
                        message: "Срок действия кода истёк",
                    };
                }

                if (
                    !safeHashEqual(
                        challenge.documentHash,
                        ctx.contract.documentHash
                    ) ||
                    !safeHashEqual(
                        ctxBefore.contract.documentHash,
                        ctx.contract.documentHash
                    )
                ) {
                    return {
                        httpStatus: 409,
                        message: "Версия документа изменилась",
                    };
                }

                const user = await User.findByPk(
                    userId,
                    { transaction }
                );

                const phone = normalizePhone(user?.phone);

                if (
                    !safeHashEqual(
                        challenge.recipientFingerprint,
                        hmac(`phone:${phone}`)
                    )
                ) {
                    return {
                        httpStatus: 409,
                        message:
                            "Номер телефона изменился",
                    };
                }

                const prereq = await prerequisites(
                    ctx,
                    userId,
                    transaction
                );

                if (
                    Number(challenge.agreementId) !==
                    Number(prereq.agreement.id)
                ) {
                    return {
                        httpStatus: 409,
                        message:
                            "Соглашение о подписи изменилось",
                    };
                }

                const alreadySigned =
                    await ContractSignature.findOne({
                        where: {
                            contractId: ctx.contract.id,
                            userId,
                        },
                        transaction,
                    });

                if (alreadySigned) {
                    return {
                        httpStatus: 409,
                        message:
                            "Документ уже подписан вами",
                    };
                }

                const expectedCodeHash = codeHash({
                    contractId: ctx.contract.id,
                    userId,
                    documentHash: ctx.contract.documentHash,
                    salt: challenge.codeSalt,
                    code,
                });

                if (
                    !safeHashEqual(
                        challenge.codeHash,
                        expectedCodeHash
                    )
                ) {
                    challenge.attemptsCount += 1;

                    if (
                        challenge.attemptsCount >=
                        challenge.maxAttempts
                    ) {
                        challenge.status = "blocked";
                    }

                    await challenge.save({ transaction });

                    return {
                        httpStatus: 400,
                        message:
                            "Неверный код или исчерпаны попытки",
                    };
                }

                await ContractSignature.create(
                    {
                        contractId: ctx.contract.id,
                        userId,
                        partyRole: ctx.partyRole,
                        method: "otp_sms",
                        documentHash:
                        ctx.contract.documentHash,
                        signedAt: now,
                        ipAddress: getIp(req),
                        userAgent: getUa(req),
                        verificationId:
                        prereq.identity.id,
                        verificationSnapshot: {
                            id: String(
                                prereq.identity.id
                            ),
                            verifiedAt:
                            prereq.identity.verifiedAt,
                            expiresAt:
                            prereq.identity.expiresAt,
                        },
                        signaturePolicyCode:
                        prereq.policy.code,
                        signaturePolicyVersion:
                        prereq.policy.version,
                        externalReference:
                        challenge.providerReference,
                        evidence: {
                            challengeId:
                                String(challenge.id),
                            agreementId:
                                String(prereq.agreement.id),
                            policySha256:
                            prereq.policy.sha256,
                            recipientFingerprint:
                            challenge.recipientFingerprint,
                        },
                    },
                    { transaction }
                );

                challenge.status = "consumed";
                challenge.verifiedAt = now;
                challenge.consumedAt = now;

                await challenge.save({ transaction });

                const signatures =
                    await ContractSignature.count({
                        where: {
                            contractId: ctx.contract.id,
                            userId: {
                                [Op.in]: [
                                    ctx.order.creatorId,
                                    ctx.order.executorId,
                                ],
                            },
                        },
                        transaction,
                    });

                const fullySigned = signatures >= 2;

                ctx.contract.status = fullySigned
                    ? "fully_signed"
                    : "partially_signed";

                if (fullySigned) {
                    ctx.contract.fullySignedAt = now;
                    ctx.contract.finalizedAt = now;
                }

                await ctx.contract.save({ transaction });

                await ContractEvent.create(
                    {
                        contractId: ctx.contract.id,
                        actorUserId: userId,
                        actorRole: ctx.partyRole,
                        eventType:
                            "signature_confirmed",
                        eventAt: now,
                        metadata: {
                            challengeId:
                                String(challenge.id),
                            documentHash:
                            ctx.contract.documentHash,
                            fullySigned,
                        },
                    },
                    { transaction }
                );

                await ActionLog.create(
                    {
                        actorUserId: userId,
                        actorRole: "user",
                        actionType:
                            "verified_contract_signed",
                        entityType: "order",
                        entityId: ctx.order.id,
                        orderId: ctx.order.id,
                        ip: getIp(req),
                        ua: getUa(req),
                        meta: {
                            contractId:
                                String(ctx.contract.id),
                            fullySigned,
                        },
                    },
                    { transaction }
                );

                return {
                    success: true,
                    fullySigned,
                    contractStatus:
                    ctx.contract.status,
                };
            }
        );

        if (result.httpStatus) {
            return res.status(result.httpStatus).json({
                success: false,
                message: result.message,
            });
        }

        return res.json(result);

    } catch (error) {
        return respondError(res, error);
    }
});

module.exports = router;
