
const express = require("express");
const crypto = require("crypto");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    requireArchivedSignaturePolicy,
    inspectArchivedAgreement,
} = require(
    "../services/signaturePolicyArchiveService"
);

const {
    getCurrentVerifiedIdentity,
} = require("../services/identityStatusService");

const {
    sequelize,
    IdentityVerification,
    ElectronicSignatureAgreement,
    ActionLog,
} = require("../models");

const {
    getSignaturePolicy,
} = require("../config/signaturePolicy");

const router = express.Router();

router.use(authenticateToken);

router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
});

function getError(status, message) {
    const error = new Error(message);
    error.httpStatus = status;
    return error;
}

function errorResponse(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            success: false,
            message: error.message,
        });
    }

    console.error(
        "Signature agreement error:",
        error
    );

    return res.status(500).json({
        success: false,
        message: "Ошибка работы с соглашением",
    });
}

function sameHash(first, second) {
    if (
        !/^[a-f0-9]{64}$/i.test(first || "") ||
        !/^[a-f0-9]{64}$/i.test(second || "")
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(first, "hex"),
        Buffer.from(second, "hex")
    );
}

async function getCurrentVerification(userId) {
    return getCurrentVerifiedIdentity(userId);
}

async function findAgreement(userId, policy) {
    return ElectronicSignatureAgreement.findOne({
        where: {
            userId,
            jurisdiction: policy.jurisdiction,
            policyCode: policy.code,
            policyVersion: policy.version,
        },
    });
}

/*
 * GET /api/contracts/e-sign/agreement
 *
 * Возвращает текущие правила,
 * проверку личности и статус принятия.
 */
router.get("/agreement", async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const policy = getSignaturePolicy();

        const archived =
            await requireArchivedSignaturePolicy(
                policy
            );

        const [verification, agreement] =
            await Promise.all([
                getCurrentVerification(userId),
                findAgreement(userId, policy),
            ]);

        const accepted =
            Boolean(agreement) &&
            sameHash(
                agreement.policySha256,
                policy.sha256
            );

        return res.json({
            success: true,

            policy: {
                ...policy,

                text: archived.policyText,
                sha256: archived.policySha256,

                archiveId:
                    String(archived.id),

                archivedAt:
                archived.archivedAt,
            },

            identityVerified:
                Boolean(verification),

            accepted,

            agreement: accepted
                ? {
                    id: agreement.id,
                    acceptedAt:
                    agreement.acceptedAt,
                    policyVersion:
                    agreement.policyVersion,
                }
                : null,

            canAccept:
                policy.enabled &&
                Boolean(verification) &&
                !accepted,
        });

    } catch (error) {
        return errorResponse(res, error);
    }
});

/*
 * POST /api/contracts/e-sign/agreement
 *
 * Тело:
 * {
 *   accepted: true,
 *   policySha256: "<hash from GET>"
 * }
 *
 * Согласие фиксируется отдельно
 * от подписи конкретного договора.
 */
router.post("/agreement", async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const policy = getSignaturePolicy();

        if (!policy.enabled) {
            throw getError(
                503,
                "Приём соглашений ещё не включён"
            );
        }

        if (req.body?.accepted !== true) {
            throw getError(
                400,
                "Необходимо явное согласие пользователя"
            );
        }

        if (
            !sameHash(
                req.body?.policySha256,
                policy.sha256
            )
        ) {
            throw getError(
                409,
                "Текст соглашения изменился. Обновите страницу."
            );
        }

        await requireArchivedSignaturePolicy(
            policy
        );

        const verification =
            await getCurrentVerification(userId);

        if (!verification) {
            throw getError(
                403,
                "Для принятия соглашения требуется действующая проверка личности"
            );
        }

        /*
         * Не доверяем клиентским IP-заголовкам.
         * Пока сохраняем фактический адрес соединения.
         * Корректное определение исходного IP
         * настроим через доверенный Nginx proxy.
         */
        const ip =
            String(
                req.socket.remoteAddress || ""
            ).slice(0, 64) || null;

        const userAgent =
            String(
                req.get("user-agent") || ""
            ).slice(0, 1000) || null;

        const result =
            await sequelize.transaction(
                async (transaction) => {
                    const archived =
                        await requireArchivedSignaturePolicy(
                            policy,
                            { transaction }
                        );
                    const [agreement, created] =
                        await ElectronicSignatureAgreement
                            .findOrCreate({
                                where: {
                                    userId,
                                    jurisdiction:
                                    policy.jurisdiction,
                                    policyCode:
                                    policy.code,
                                    policyVersion:
                                    policy.version,
                                },

                                defaults: {
                                    policySha256:
                                    policy.sha256,

                                    acceptedAt:
                                        new Date(),

                                    ipAddress: ip,
                                    userAgent,

                                    evidence: {
                                        acceptanceMethod:
                                            "authenticated_ui",

                                        identityVerificationId:
                                            String(
                                                verification.id
                                            ),
                                        policyArchiveId:
                                            String(archived.id),

                                        policySha256:
                                        archived.policySha256,
                                    },
                                },

                                transaction,
                            });

                    /*
                     * Если кто-то изменил текст
                     * без смены версии — не
                     * принимаем такое соглашение.
                     */
                    if (
                        !sameHash(
                            agreement.policySha256,
                            policy.sha256
                        )
                    ) {
                        throw getError(
                            409,
                            "Конфликт редакции соглашения"
                        );
                    }
                    const savedArchiveId =
                        agreement.evidence?.policyArchiveId;

                    if (
                        savedArchiveId &&
                        String(savedArchiveId) !==
                        String(archived.id)
                    ) {
                        throw getError(
                            409,
                            "Соглашение связано с другой архивной редакцией"
                        );
                    }

                    if (created) {
                        await ActionLog.create(
                            {
                                actorUserId: userId,
                                actorRole: "user",

                                actionType:
                                    "signature_agreement_accepted",

                                entityType: "user",
                                entityId: userId,

                                ip,
                                ua: userAgent,

                                meta: {
                                    agreementId:
                                        String(agreement.id),
                                    policyArchiveId:
                                        String(archived.id),

                                    policyCode:
                                    policy.code,

                                    policyVersion:
                                    policy.version,

                                    policySha256:
                                    policy.sha256,

                                    verificationId:
                                        String(
                                            verification.id
                                        ),
                                },
                            },
                            { transaction }
                        );
                    }

                    return {
                        agreement,
                        created,
                    };
                }
            );

        return res.json({
            success: true,

            accepted: true,
            created: result.created,

            agreement: {
                id: result.agreement.id,
                acceptedAt:
                result.agreement.acceptedAt,

                policyVersion:
                result.agreement.policyVersion,
            },
        });

    } catch (error) {
        return errorResponse(res, error);
    }
});


/*
 * GET /api/contracts/e-sign/my-agreements
 *
 * Пользователь видит только собственные
 * согласия и полный текст соответствующих
 * архивных редакций.
 */
router.get(
    "/my-agreements",
    async (req, res) => {
        try {
            const userId =
                Number(req.user.id);

            const agreements =
                await ElectronicSignatureAgreement
                    .findAll({
                        where: { userId },

                        order: [
                            ["acceptedAt", "DESC"],
                            ["id", "DESC"],
                        ],

                        limit: 100,
                    });

            const result = [];

            for (const agreement of agreements) {
                const archive =
                    await inspectArchivedAgreement(
                        agreement
                    );

                result.push({
                    id: String(agreement.id),

                    acceptedAt:
                    agreement.acceptedAt,

                    jurisdiction:
                    agreement.jurisdiction,

                    policyCode:
                    agreement.policyCode,

                    version:
                    agreement.policyVersion,

                    sha256:
                    agreement.policySha256,

                    archiveVerified:
                    archive.valid,

                    archiveId:
                    archive.archiveId,

                    policyText:
                    archive.text,
                });
            }

            return res.json({
                success: true,
                agreements: result,
            });

        } catch (error) {
            return errorResponse(
                res,
                error
            );
        }
    }
);


module.exports = router;
