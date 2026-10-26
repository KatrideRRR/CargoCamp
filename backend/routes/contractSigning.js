
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
    Dispute,
    OrderChangeRequest,
    PepEnrollment,
    AuthSession,
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
        ![
            "verified_assignment",
            "verified_completion_act",
            "verified_addendum",
        ].includes(contract.type)
    ) {
        throw fail(404, "Документ не найден");
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


async function assertDocumentReadyForSigning(
    ctx,
    transaction = null
) {
    const { contract, order } = ctx;


    if (contract.type === "verified_addendum") {
        if (
            order.status !== "active" ||
            order.paymentType !== "cash"
        ) {
            throw fail(
                409,
                "Дополнительное соглашение недоступно для этого заказа"
            );
        }

        if (
            Array.isArray(order.completedBy) &&
            order.completedBy.length > 0
        ) {
            throw fail(
                409,
                "Нельзя подписать изменение после подтверждения завершения"
            );
        }

        const change = await OrderChangeRequest.findOne({
            where: {
                orderId: order.id,
                agreementContractId: contract.id,
                status: "approved_pending_agreement",
            },
            transaction,
        });

        if (!change) {
            throw fail(
                409,
                "Согласованное предложение не найдено"
            );
        }

        if (
            Number(order.finalPriceKopecks) !==
            Number(change.basePriceKopecks)
        ) {
            throw fail(
                409,
                "Согласованная цена заказа изменилась"
            );
        }

        const parent = await Contract.findByPk(
            contract.parentContractId,
            { transaction }
        );

        if (
            !parent ||
            Number(parent.orderId) !== Number(order.id) ||
            parent.type !== "verified_assignment" ||
            parent.status !== "fully_signed" ||
            !parent.fullySignedAt
        ) {
            throw fail(
                409,
                "Основной договор должен быть подписан обеими сторонами"
            );
        }

        const dispute = await Dispute.findOne({
            where: {
                orderId: order.id,
                orderType: "regular",
                status: {
                    [Op.in]: [
                        "open",
                        "in_review",
                        "waiting_creator",
                        "waiting_executor",
                    ],
                },
            },
            transaction,
        });

        if (dispute) {
            throw fail(
                409,
                "По заказу есть открытый спор"
            );
        }

        return;
    }


    if (
        contract.type ===
        "verified_assignment"
    ) {
        /*
         * Нельзя впервые оформлять договор
         * как подписанный до работы,
         * когда работа уже началась.
         */
        if (
            order.workStartedAt ||
            order.status === "completed"
        ) {
            throw fail(
                409,
                "Договор-задание нужно подписать до начала работы"
            );
        }

        return;
    }

    if (
        contract.type !==
        "verified_completion_act"
    ) {
        throw fail(
            409,
            "Тип документа не поддерживается"
        );
    }

    if (order.status !== "completed") {
        throw fail(
            409,
            "Акт можно подписать после завершения заказа"
        );
    }

    const latestAct =
        await Contract.findOne({
            where: {
                orderId: order.id,
                type:
                    "verified_completion_act",
            },

            order: [
                ["version", "DESC"],
                ["id", "DESC"],
            ],

            transaction,
        });

    if (
        !latestAct ||
        String(latestAct.id) !==
        String(contract.id) ||
        contract.supersededAt
    ) {
        throw fail(
            409,
            "Для заказа существует более новая версия акта"
        );
    }

    /*
     * В подтверждённой сделке акт должен
     * быть связан с ранее подписанным
     * договором-заданием.
     */
    const assignment =
        await Contract.findOne({
            where: {
                orderId: order.id,
                type: "verified_assignment",
            },

            order: [
                ["version", "DESC"],
                ["id", "DESC"],
            ],

            transaction,
        });

    if (
        !assignment ||
        assignment.status !==
        "fully_signed" ||
        !assignment.fullySignedAt
    ) {
        throw fail(
            409,
            "Перед подписанием акта требуется подписанный договор-задание"
        );
    }

    /*
     * Отметка order.completed — не то же
     * самое, что приёмка без замечаний.
     */
    const decision =
        await ContractEvent.findOne({
            where: {
                contractId: contract.id,
                eventType:
                    "act_customer_decision",
            },

            order: [
                ["id", "DESC"],
            ],

            transaction,
        });

    if (
        !decision ||
        decision.metadata?.decision !==
        "accepted" ||
        Number(decision.actorUserId) !==
        Number(order.creatorId) ||
        !safeHashEqual(
            decision.metadata?.documentHash,
            contract.documentHash
        )
    ) {
        throw fail(
            409,
            "Заказчик ещё не принял эту версию акта без замечаний"
        );
    }

    const dispute =
        await Dispute.findOne({
            where: {
                orderId: order.id,
                orderType: "regular",

                status: {
                    [Op.in]: [
                        "open",
                        "in_review",
                        "waiting_creator",
                        "waiting_executor",
                    ],
                },
            },

            transaction,
        });

    if (dispute) {
        throw fail(
            409,
            "Подписание акта заблокировано из-за открытого спора"
        );
    }
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


async function getActivePepEnrollment({
                                          userId,
                                          policy,
                                          phone,
                                          verification,
                                          transaction = null,
                                      }) {
    if (
        !policy.enabled ||
        !verification ||
        !/^[a-f0-9]{64}$/i.test(
            process.env.SIGNATURE_OTP_SECRET_HEX || ""
        )
    ) {
        return null;
    }

    const enrollment = await PepEnrollment.findOne({
        where: { userId },
        transaction,
    });

    if (
        !enrollment ||
        enrollment.revokedAt ||
        new Date(enrollment.expiresAt).getTime() <= Date.now() ||
        enrollment.policyCode !== policy.code ||
        enrollment.policyVersion !== policy.version ||
        !safeHashEqual(enrollment.policySha256, policy.sha256) ||
        Number(enrollment.verificationId) !==
        Number(verification.id)
    ) {
        return null;
    }

    let normalizedPhone;

    try {
        normalizedPhone = normalizePhone(phone);
    } catch {
        return null;
    }

    const fingerprint = hmac(`phone:${normalizedPhone}`);

    if (
        !safeHashEqual(
            enrollment.phoneFingerprint,
            fingerprint
        )
    ) {
        return null;
    }

    return enrollment;
}

async function hasRecentSigningSession(req) {
    if (
        req.user?.scope !== "user" ||
        !req.user?.sid
    ) {
        return false;
    }

    const session = await AuthSession.findByPk(
        req.user.sid
    );

    if (
        !session ||
        session.scope !== "user" ||
        Number(session.userId) !== Number(req.user.id) ||
        session.revokedAt ||
        new Date(session.expiresAt).getTime() <= Date.now() ||
        new Date(session.absoluteExpiresAt).getTime() <= Date.now()
    ) {
        return false;
    }

    // Для подписания без SMS требуется
    // вход в аккаунт не старше семи дней.
    const sessionAge =
        Date.now() - new Date(session.createdAt).getTime();

    return Number.isFinite(sessionAge) &&
        sessionAge >= 0 &&
        sessionAge <= 7 * 24 * 60 * 60 * 1000;
}


function requireUnsigned(contract) {

    if (
        !["2", "3", "4", "5"].includes(
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

        let blockedReason = null;

        try {
            await assertDocumentReadyForSigning(
                ctx
            );
        } catch (error) {
            if (error.httpStatus === 409) {
                blockedReason = error.message;
            } else {
                throw error;
            }
        }

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


        const myIdentity =
            ctx.partyRole === "creator"
                ? identities[0]
                : identities[1];

        const pepEnrollment =
            await getActivePepEnrollment({
                userId,
                policy,
                phone,
                verification: myIdentity,
            });

        const recentSession =
            await hasRecentSigningSession(req);

        const signingMethod = pepEnrollment
            ? recentSession
                ? "click"
                : "reauth"
            : "sms";


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
            enabled: enabled || (
                policy.enabled && Boolean(pepEnrollment)
            ),
            signingMethod,
            pepActivatedAt:
                pepEnrollment?.activatedAt || null,
            pepExpiresAt:
                pepEnrollment?.expiresAt || null,
            accepted,
            identitiesValid,
            mySigned,
            otherSigned,
            blockedReason,
            contractStatus: ctx.contract.status,
            maskedPhone: phone ? maskPhone(phone) : null,
            canSign:
                (
                    signingMethod === "click" ||
                    (signingMethod === "sms" && enabled)
                ) &&
                accepted &&
                identitiesValid &&
                Boolean(phone) &&
                !blockedReason &&
                !mySigned &&
                ["2", "3", "4", "5"].includes(
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

        await assertDocumentReadyForSigning(
            existingCtx
        );

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
                const ctx = await getContext(
                    req.params.contractId,
                    userId,
                    transaction,
                    true
                );

                const user = await User.findByPk(userId, {
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                if (!user) {
                    throw fail(401, "Пользователь не найден");
                }

                const phone = normalizePhone(user.phone);

                requireUnsigned(ctx.contract);

                await assertDocumentReadyForSigning(
                    ctx,
                    transaction
                );

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

        await assertDocumentReadyForSigning(
            ctxBefore
        );

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

                await assertDocumentReadyForSigning(
                    ctx,
                    transaction
                );

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

                const savedSignature = await ContractSignature.create(
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


                // Успешная SMS-подпись одновременно
                // подтверждает подключение ПЭП.
                // Срок действия — 180 дней.
                const pepExpiresAt = new Date(
                    now.getTime() + 180 * 24 * 60 * 60 * 1000
                );


                const previousEnrollment = await PepEnrollment.findOne({
                    where: { userId },
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                await ActionLog.create(
                    {
                        actorUserId: userId,
                        actorRole: "user",

                        actionType: previousEnrollment
                            ? "pep_enrollment_reactivated"
                            : "pep_enrollment_activated",

                        entityType: "user",
                        entityId: userId,

                        ip: getIp(req),
                        ua: getUa(req),

                        meta: {
                            method: "otp_sms",
                            contractId: String(ctx.contract.id),

                            bootstrapSignatureId:
                                String(savedSignature.id),

                            bootstrapChallengeId:
                                String(challenge.id),

                            agreementId:
                                String(prereq.agreement.id),

                            identityVerificationId:
                                String(prereq.identity.id),

                            policyVersion:
                            prereq.policy.version,

                            policySha256:
                            prereq.policy.sha256,

                            activatedAt:
                                now.toISOString(),

                            expiresAt:
                                pepExpiresAt.toISOString(),

                            previousEnrollment: previousEnrollment
                                ? {
                                    id: String(previousEnrollment.id),

                                    bootstrapSignatureId:
                                        String(
                                            previousEnrollment.bootstrapSignatureId
                                        ),

                                    activatedAt:
                                    previousEnrollment.activatedAt,

                                    expiresAt:
                                    previousEnrollment.expiresAt,

                                    revokedAt:
                                    previousEnrollment.revokedAt,

                                    revokeReason:
                                    previousEnrollment.revokeReason,
                                }
                                : null,
                        },
                    },
                    { transaction }
                );


                await PepEnrollment.upsert(
                    {
                        userId,
                        agreementId: prereq.agreement.id,
                        verificationId: prereq.identity.id,
                        bootstrapSignatureId: savedSignature.id,
                        bootstrapChallengeId: challenge.id,

                        policyCode: prereq.policy.code,
                        policyVersion: prereq.policy.version,
                        policySha256: prereq.policy.sha256,

                        // Отпечаток телефона уже получен
                        // при отправке проверенного SMS.
                        phoneFingerprint:
                        challenge.recipientFingerprint,

                        activatedAt: now,
                        expiresAt: pepExpiresAt,

                        revokedAt: null,
                        revokedBy: null,
                        revokeReason: null,
                    },
                    { transaction }
                );


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


                let addendumApplied = false;

                if (
                    fullySigned &&
                    ctx.contract.type === "verified_addendum"
                ) {
                    const orderForUpdate = await Order.findByPk(
                        ctx.order.id,
                        {
                            transaction,
                            lock: transaction.LOCK.UPDATE,
                        }
                    );

                    const change = await OrderChangeRequest.findOne({
                        where: {
                            orderId: ctx.order.id,
                            agreementContractId: ctx.contract.id,
                            status: "approved_pending_agreement",
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                    if (!change) {
                        throw fail(
                            409,
                            "Согласованное изменение заказа не найдено"
                        );
                    }

                    if (
                        !orderForUpdate ||
                        orderForUpdate.status !== "active" ||
                        orderForUpdate.paymentType !== "cash" ||
                        (
                            Array.isArray(orderForUpdate.completedBy) &&
                            orderForUpdate.completedBy.length > 0
                        ) ||
                        Number(orderForUpdate.finalPriceKopecks) !==
                        Number(change.basePriceKopecks)
                    ) {
                        throw fail(
                            409,
                            "Условия заказа изменились. Применение новой цены невозможно."
                        );
                    }

                    orderForUpdate.finalPriceKopecks =
                        Number(change.proposedPriceKopecks);

                    orderForUpdate.proposedSum = Math.round(
                        Number(change.proposedPriceKopecks) / 100
                    );

                    await orderForUpdate.save({ transaction });

                    change.status = "applied";
                    change.appliedAt = now;

                    await change.save({ transaction });

                    await ContractEvent.create(
                        {
                            contractId: ctx.contract.id,
                            actorUserId: null,
                            actorRole: "system",
                            eventType: "addendum_applied",
                            eventAt: now,
                            metadata: {
                                changeId: String(change.id),
                                basePriceKopecks:
                                change.basePriceKopecks,
                                newPriceKopecks:
                                change.proposedPriceKopecks,
                                documentHash:
                                ctx.contract.documentHash,
                            },
                        },
                        { transaction }
                    );

                    addendumApplied = true;
                }


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
                    contractStatus: ctx.contract.status,
                    addendumApplied,
                    orderId: ctx.order.id,
                };
            }
        );

        if (result.httpStatus) {
            return res.status(result.httpStatus).json({
                success: false,
                message: result.message,
            });
        }


        if (result.addendumApplied) {
            const io = req.app.locals.io;

            if (io) {
                const updatedOrder = await Order.findByPk(result.orderId, {
                    attributes: [
                        "creatorId",
                        "executorId",
                    ],
                });

                if (updatedOrder) {
                    for (const id of [
                        updatedOrder.creatorId,
                        updatedOrder.executorId,
                    ]) {
                        io.to(`user_${id}`).emit(
                            "activeOrdersUpdated",
                            {
                                orderId: result.orderId,
                                orderType: "regular",
                                reason: "addendum_applied",
                            }
                        );
                    }
                }
            }
        }

        return res.json(result);

    } catch (error) {
        return respondError(res, error);
    }
});


// Подписание документа кнопкой после первичного SMS-подтверждения.
router.post("/:contractId/click-sign", async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const policy = getSignaturePolicy();

        if (!policy.enabled) {
            throw fail(503, "Электронное подписание не включено");
        }

        if (req.body?.intentConfirmed !== true) {
            throw fail(400, "Подтвердите намерение подписать документ");
        }

        if (!(await hasRecentSigningSession(req))) {
            throw fail(
                403,
                "Для подписания войдите в аккаунт повторно"
            );
        }

        const before = await getContext(
            req.params.contractId,
            userId
        );

        requireUnsigned(before.contract);

        await assertDocumentReadyForSigning(before);

        if (
            !safeHashEqual(
                req.body?.documentHash,
                before.contract.documentHash
            )
        ) {
            throw fail(409, "Документ изменился. Обновите страницу.");
        }

        await assertVerifiedPdfIntegrity(before.contract);

        const result = await sequelize.transaction(
            async (transaction) => {
                const ctx = await getContext(
                    req.params.contractId,
                    userId,
                    transaction,
                    true
                );

                requireUnsigned(ctx.contract);
                await assertDocumentReadyForSigning(ctx, transaction);

                if (
                    !safeHashEqual(
                        before.contract.documentHash,
                        ctx.contract.documentHash
                    )
                ) {
                    throw fail(409, "Документ изменился");
                }

                const existing = await ContractSignature.findOne({
                    where: {
                        contractId: ctx.contract.id,
                        userId,
                    },
                    transaction,
                });

                if (existing) {
                    throw fail(409, "Вы уже подписали этот документ");
                }

                const prereq = await prerequisites(
                    ctx,
                    userId,
                    transaction
                );

                const user = await User.findByPk(userId, {
                    transaction,
                });

                const enrollment =
                    await getActivePepEnrollment({
                        userId,
                        policy: prereq.policy,
                        phone: user?.phone,
                        verification: prereq.identity,
                        transaction,
                    });

                if (!enrollment) {
                    throw fail(
                        403,
                        "Требуется первичное или повторное SMS-подтверждение ПЭП"
                    );
                }

                const now = new Date();

                await ContractSignature.create(
                    {
                        contractId: ctx.contract.id,
                        userId,
                        partyRole: ctx.partyRole,
                        method: "authenticated_click",
                        documentHash: ctx.contract.documentHash,
                        signedAt: now,
                        ipAddress: getIp(req),
                        userAgent: getUa(req),
                        verificationId: prereq.identity.id,

                        verificationSnapshot: {
                            id: String(prereq.identity.id),
                            verifiedAt: prereq.identity.verifiedAt,
                            expiresAt: prereq.identity.expiresAt,
                        },

                        signaturePolicyCode: prereq.policy.code,
                        signaturePolicyVersion: prereq.policy.version,

                        evidence: {
                            method: "authenticated_click",
                            sessionId: String(req.user.sid),
                            pepEnrollmentId: String(enrollment.id),
                            bootstrapSignatureId:
                                String(enrollment.bootstrapSignatureId),
                            agreementId: String(prereq.agreement.id),
                            policySha256: prereq.policy.sha256,
                            documentHash: ctx.contract.documentHash,
                            intentConfirmed: true,
                        },
                    },
                    { transaction }
                );

                const count = await ContractSignature.count({
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

                const fullySigned = count >= 2;

                ctx.contract.status = fullySigned
                    ? "fully_signed"
                    : "partially_signed";

                if (fullySigned) {
                    ctx.contract.fullySignedAt = now;
                    ctx.contract.finalizedAt = now;
                }

                await ctx.contract.save({ transaction });

                let addendumApplied = false;

                if (
                    fullySigned &&
                    ctx.contract.type === "verified_addendum"
                ) {
                    const updatedOrder = await Order.findByPk(
                        ctx.order.id,
                        {
                            transaction,
                            lock: transaction.LOCK.UPDATE,
                        }
                    );

                    const change = await OrderChangeRequest.findOne({
                        where: {
                            orderId: ctx.order.id,
                            agreementContractId: ctx.contract.id,
                            status: "approved_pending_agreement",
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                    if (
                        !change ||
                        !updatedOrder ||
                        updatedOrder.status !== "active" ||
                        updatedOrder.paymentType !== "cash" ||
                        (
                            Array.isArray(updatedOrder.completedBy) &&
                            updatedOrder.completedBy.length > 0
                        ) ||
                        Number(updatedOrder.finalPriceKopecks) !==
                        Number(change.basePriceKopecks)
                    ) {
                        throw fail(
                            409,
                            "Условия заказа изменились. Соглашение нельзя применить."
                        );
                    }

                    updatedOrder.finalPriceKopecks =
                        Number(change.proposedPriceKopecks);

                    updatedOrder.proposedSum =
                        Math.round(
                            Number(change.proposedPriceKopecks) / 100
                        );

                    await updatedOrder.save({ transaction });

                    change.status = "applied";
                    change.appliedAt = now;

                    await change.save({ transaction });

                    await ContractEvent.create(
                        {
                            contractId: ctx.contract.id,
                            actorUserId: null,
                            actorRole: "system",
                            eventType: "addendum_applied",
                            eventAt: now,
                            metadata: {
                                changeId: String(change.id),
                                basePriceKopecks: change.basePriceKopecks,
                                newPriceKopecks: change.proposedPriceKopecks,
                                documentHash: ctx.contract.documentHash,
                            },
                        },
                        { transaction }
                    );

                    addendumApplied = true;
                }

                await ContractEvent.create(
                    {
                        contractId: ctx.contract.id,
                        actorUserId: userId,
                        actorRole: ctx.partyRole,
                        eventType: "signature_confirmed",
                        eventAt: now,
                        metadata: {
                            method: "authenticated_click",
                            pepEnrollmentId: String(enrollment.id),
                            sessionId: String(req.user.sid),
                            documentHash: ctx.contract.documentHash,
                            fullySigned,
                        },
                    },
                    { transaction }
                );

                await ActionLog.create(
                    {
                        actorUserId: userId,
                        actorRole: "user",
                        actionType: "verified_contract_signed",
                        entityType: "order",
                        entityId: ctx.order.id,
                        orderId: ctx.order.id,
                        ip: getIp(req),
                        ua: getUa(req),
                        meta: {
                            contractId: String(ctx.contract.id),
                            method: "authenticated_click",
                            fullySigned,
                        },
                    },
                    { transaction }
                );

                return {
                    success: true,
                    fullySigned,
                    contractStatus: ctx.contract.status,
                    addendumApplied,
                    orderId: ctx.order.id,
                };
            }
        );

        if (result.addendumApplied) {
            const io = req.app.locals.io;

            if (io) {
                const order = await Order.findByPk(result.orderId, {
                    attributes: ["creatorId", "executorId"],
                });

                if (order) {
                    for (const id of [
                        order.creatorId,
                        order.executorId,
                    ]) {
                        io.to(`user_${id}`).emit(
                            "activeOrdersUpdated",
                            {
                                orderId: result.orderId,
                                orderType: "regular",
                                reason: "addendum_applied",
                            }
                        );
                    }
                }
            }
        }

        return res.json(result);
    } catch (error) {
        return respondError(res, error);
    }
});


module.exports = router;
