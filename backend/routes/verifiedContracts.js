
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    Order,
    Contract,
    ActionLog,
} = require("../models");

const {
    contractsRoot,
} = require("../config/storagePaths");

const router = express.Router();

const verifiedRoot = path.join(
    contractsRoot,
    "verified"
);

function validId(value) {
    return /^[1-9]\d*$/.test(
        String(value || "")
    );
}

async function getAccessibleOrder(
    orderId,
    userId
) {
    const order = await Order.findByPk(
        orderId,
        {
            attributes: [
                "id",
                "creatorId",
                "executorId",
            ],
        }
    );

    if (!order) return null;

    const allowed =
        Number(order.creatorId) ===
        Number(userId) ||
        Number(order.executorId) ===
        Number(userId);

    return allowed ? order : null;
}

/*
 * GET /api/contracts/orders/:orderId/assignment
 *
 * Только заказчик и исполнитель.
 */
router.get(
    "/orders/:orderId/assignment",
    authenticateToken,
    async (req, res) => {
        try {
            if (!validId(req.params.orderId)) {
                return res.status(400).json({
                    message: "Некорректный ID заказа",
                });
            }

            const order =
                await getAccessibleOrder(
                    req.params.orderId,
                    req.user.id
                );

            if (!order) {
                return res.sendStatus(404);
            }

            const contract =
                await Contract.findOne({
                    where: {
                        orderId: order.id,
                        type: "verified_assignment",
                    },

                    attributes: [
                        "id",
                        "orderId",
                        "type",
                        "version",
                        "status",
                        "documentNumber",
                        "documentHash",
                        "createdAt",
                        "finalizedAt",
                        "fullySignedAt",
                    ],

                    order: [
                        ["version", "DESC"],
                    ],
                });

            return res.json({
                success: true,
                contract: contract || null,
            });

        } catch (error) {
            console.error(
                "Ошибка получения договора:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить договор",
            });
        }
    }
);

/*
 * GET /api/contracts/:contractId/file
 *
 * Скачивание только участниками заказа.
 */
router.get(
    "/:contractId/file",
    authenticateToken,
    async (req, res) => {
        try {
            if (!validId(req.params.contractId)) {
                return res.status(400).json({
                    message:
                        "Некорректный ID документа",
                });
            }

            const contract =
                await Contract.findOne({
                    where: {
                        id: req.params.contractId,
                        type: "verified_assignment",
                    },
                });

            if (!contract) {
                return res.sendStatus(404);
            }

            const order =
                await getAccessibleOrder(
                    contract.orderId,
                    req.user.id
                );

            if (!order) {
                return res.sendStatus(404);
            }

            /*
             * Хранилище нельзя выбирать
             * произвольным путём из базы.
             *
             * Проверяем точный формат ключа.
             */
            const prefix =
                `verified/verified_assignment_` +
                `${contract.orderId}_` +
                `v${contract.version}_`;

            const storageKey =
                String(contract.storageKey || "");

            if (!storageKey.startsWith(prefix)) {
                return res.sendStatus(404);
            }

            const suffix =
                storageKey.slice(prefix.length);

            if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i
                    .test(suffix)
            ) {
                return res.sendStatus(404);
            }

            const fileName =
                path.posix.basename(storageKey);

            const absolutePath = path.join(
                verifiedRoot,
                fileName
            );

            let realRoot;
            let realFile;

            try {
                realRoot = await fs.realpath(
                    verifiedRoot
                );

                realFile = await fs.realpath(
                    absolutePath
                );
            } catch (error) {
                if (error.code === "ENOENT") {
                    return res.sendStatus(404);
                }

                throw error;
            }

            /*
             * Запрещаем чтение через symlink
             * за пределами закрытого каталога.
             */
            if (
                path.dirname(realFile) !== realRoot
            ) {
                return res.sendStatus(404);
            }

            const pdfBuffer =
                await fs.readFile(realFile);

            const actualHash = crypto
                .createHash("sha256")
                .update(pdfBuffer)
                .digest("hex");

            if (
                !contract.documentHash ||
                actualHash !== contract.documentHash
            ) {
                console.error(
                    "Contract hash mismatch:",
                    contract.id
                );

                return res.status(409).json({
                    success: false,
                    message:
                        "Нарушена целостность договора",
                });
            }

            /*
             * Журналируем выдачу документа.
             *
             * Если запись аудита невозможна,
             * файл не выдаём.
             */
            await ActionLog.create({
                actorUserId: req.user.id,
                actorRole: "user",

                actionType:
                    "verified_contract_downloaded",

                entityType: "order",
                entityId: order.id,
                orderId: order.id,

                meta: {
                    contractId:
                        String(contract.id),

                    version:
                    contract.version,

                    documentHash:
                    contract.documentHash,
                },
            });

            res.setHeader(
                "Cache-Control",
                "private, no-store, max-age=0"
            );

            res.setHeader(
                "Pragma",
                "no-cache"
            );

            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="verified-assignment-${order.id}-v${contract.version}.pdf"`
            );

            res.setHeader(
                "Content-Length",
                pdfBuffer.length
            );

            return res.end(pdfBuffer);

        } catch (error) {
            console.error(
                "Ошибка скачивания договора:",
                error
            );

            if (res.headersSent) return;

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось скачать договор",
            });
        }
    }
);

module.exports = router;
