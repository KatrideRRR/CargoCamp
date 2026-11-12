
const express = require("express");
const authenticateToken = require("../middlewares/userAuth");

const {
    sequelize,
    PublicOfferAcceptance,
    ActionLog,
} = require("../models");

const {
    CURRENT_OFFER,
} = require("../services/publicOfferConsentService");

const router = express.Router();

router.get("/current", (req, res) => {
    return res.json(CURRENT_OFFER);
});

router.get("/status", authenticateToken, async (req, res) => {
    try {
        const record = await PublicOfferAcceptance.findOne({
            where: {
                userId: req.user.id,
                offerVersion: CURRENT_OFFER.version,
                offerSha256: CURRENT_OFFER.sha256,
            },
        });

        return res.json({
            version: CURRENT_OFFER.version,
            sha256: CURRENT_OFFER.sha256,
            accepted: Boolean(record),
            acceptedAt: record?.acceptedAt || null,
        });
    } catch (error) {
        console.error("Offer status error:", error);

        return res.status(500).json({
            message: "Не удалось проверить согласие с офертой",
        });
    }
});

router.post("/accept", authenticateToken, async (req, res) => {
    const {
        version,
        sha256,
        confirmed,
    } = req.body || {};

    if (confirmed !== true) {
        return res.status(400).json({
            message: "Требуется явное согласие пользователя",
        });
    }

    if (
        version !== CURRENT_OFFER.version ||
        sha256 !== CURRENT_OFFER.sha256
    ) {
        return res.status(409).json({
            message: "Редакция оферты изменилась. Ознакомьтесь с актуальной версией.",
        });
    }

    try {
        const result = await sequelize.transaction(
            async (transaction) => {
                const [record, created] =
                    await PublicOfferAcceptance.findOrCreate({
                        where: {
                            userId: req.user.id,
                            offerVersion: CURRENT_OFFER.version,
                        },
                        defaults: {
                            offerSha256: CURRENT_OFFER.sha256,
                            source: "existing_user",
                            ipAddress: req.ip || null,
                            userAgent: String(
                                req.get("user-agent") || ""
                            ).slice(0, 2048),
                        },
                        transaction,
                    });

                if (
                    record.offerSha256 !==
                    CURRENT_OFFER.sha256
                ) {
                    const error = new Error(
                        "Версия оферты связана с другим документом"
                    );
                    error.status = 409;
                    throw error;
                }

                if (created) {
                    await ActionLog.create(
                        {
                            actorUserId: req.user.id,
                            actorRole: "user",
                            actionType: "public_offer_accepted",
                            entityType: "user",
                            entityId: req.user.id,
                            severity: "info",
                            success: true,
                            ip: req.ip || null,
                            ua: String(
                                req.get("user-agent") || ""
                            ).slice(0, 2048),
                            meta: {
                                version: CURRENT_OFFER.version,
                                sha256: CURRENT_OFFER.sha256,
                                source: "existing_user",
                            },
                        },
                        { transaction }
                    );
                }

                return {
                    acceptedAt: record.acceptedAt,
                    created,
                };
            }
        );

        return res.json({
            accepted: true,
            version: CURRENT_OFFER.version,
            acceptedAt: result.acceptedAt,
            alreadyAccepted: !result.created,
        });
    } catch (error) {
        console.error("Offer acceptance error:", error);

        return res.status(error.status || 500).json({
            message: error.status
                ? error.message
                : "Не удалось сохранить согласие",
        });
    }
});

module.exports = router;
