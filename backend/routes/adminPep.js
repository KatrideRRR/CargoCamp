
const express = require("express");

const {
    authMiddleware,
    adminMiddleware,
} = require("../middlewares/adminAuth");

const {
    sequelize,
    PepEnrollment,
    ActionLog,
} = require("../models");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

router.get("/enrollments", async (req, res) => {
    try {
        const enrollments = await PepEnrollment.findAll({
            attributes: [
                "userId",
                "policyVersion",
                "activatedAt",
                "expiresAt",
                "revokedAt",
                "revokeReason",
            ],
        });

        return res.json({
            success: true,
            enrollments,
        });
    } catch (error) {
        console.error("Admin PEP list:", error);

        return res.status(500).json({
            success: false,
            message: "Не удалось загрузить статусы ПЭП",
        });
    }
});

router.post("/:userId/revoke", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const reason = String(req.body?.reason || "").trim();

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({
                message: "Некорректный ID пользователя",
            });
        }

        if (reason.length < 10 || reason.length > 255) {
            return res.status(400).json({
                message: "Укажите причину отзыва: от 10 до 255 символов",
            });
        }

        const updated = await sequelize.transaction(
            async (transaction) => {
                const enrollment = await PepEnrollment.findOne({
                    where: { userId },
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                if (!enrollment || enrollment.revokedAt) {
                    return false;
                }

                enrollment.revokedAt = new Date();
                enrollment.revokedBy = req.user.id;
                enrollment.revokeReason = reason;

                await enrollment.save({ transaction });

                await ActionLog.create(
                    {
                        actorUserId: req.user.id,
                        actorRole: "admin",
                        actionType: "pep_enrollment_revoked",
                        entityType: "user",
                        entityId: userId,
                        meta: {
                            enrollmentId: String(enrollment.id),
                            reason,
                        },
                    },
                    { transaction }
                );

                return true;
            }
        );

        if (!updated) {
            return res.status(409).json({
                message: "Активное подтверждение ПЭП не найдено",
            });
        }

        return res.json({
            success: true,
            message: "ПЭП отозвана. Для повторной активации потребуется SMS.",
        });
    } catch (error) {
        console.error("Admin PEP revoke:", error);

        return res.status(500).json({
            success: false,
            message: "Не удалось отозвать ПЭП",
        });
    }
});

module.exports = router;
