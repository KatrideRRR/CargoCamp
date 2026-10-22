const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Op } = require("sequelize");
const router = express.Router();

const authenticateToken = require("../middlewares/userAuth");
const {Order, Contract, ActionLog,} = require("../models");
const {contractsRoot,} = require("../config/storagePaths");


const verifiedRoot = path.join(contractsRoot, "verified");

function validId(value) {
    return /^[1-9]\d*$/.test(
        String(value || "")
    );
}

async function getAccessibleOrder(orderId, userId) {
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

router.post("/assignments/summary", authenticateToken, async (req, res) => {
        try {
            const rawIds = req.body?.orderIds;

            if (
                !Array.isArray(rawIds) ||
                rawIds.length > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Передайте не более 100 номеров заказов",
                });
            }

            if (
                rawIds.some(
                    (id) =>
                        !Number.isSafeInteger(id) ||
                        id <= 0
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректные номера заказов",
                });
            }

            const orderIds = [
                ...new Set(rawIds),
            ];

            if (orderIds.length === 0) {
                return res.json({
                    success: true,
                    assignments: [],
                });
            }

            const userId = Number(req.user.id);

            /*
             * Сначала оставляем только заказы,
             * где текущий пользователь является
             * заказчиком или исполнителем.
             */
            const allowedOrders =
                await Order.findAll({
                    where: {
                        id: {
                            [Op.in]: orderIds,
                        },

                        [Op.or]: [
                            { creatorId: userId },
                            { executorId: userId },
                        ],
                    },

                    attributes: ["id"],
                });

            const allowedIds = allowedOrders.map(
                (order) => Number(order.id)
            );

            if (allowedIds.length === 0) {
                return res.json({
                    success: true,
                    assignments: [],
                });
            }

            /*
             * Читаем только проекты
             * подтверждённых договоров.
             *
             * Не возвращаем:
             * - storageKey;
             * - PDF;
             * - персональные документы;
             * - снимки паспортной проверки.
             */
            const contracts =
                await Contract.findAll({
                    where: {
                        orderId: {
                            [Op.in]: allowedIds,
                        },

                        type: {
                            [Op.in]: [
                                "verified_assignment",
                                "verified_completion_act",
                            ],
                        },
                    },

                    attributes: [
                        "id",
                        "orderId",
                        "parentContractId",
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
                        ["orderId", "ASC"],
                        ["version", "DESC"],
                        ["id", "DESC"],
                    ],
                });


            const assignmentsByOrder = new Map();
            const actsByOrder = new Map();

            for (const contract of contracts) {
                const orderKey = String(
                    contract.orderId
                );

                const target =
                    contract.type === "verified_assignment"
                        ? assignmentsByOrder
                        : contract.type === "verified_completion_act"
                            ? actsByOrder
                            : null;

                if (target && !target.has(orderKey)) {
                    target.set(
                        orderKey,
                        contract
                    );
                }
            }

            return res.json({
                success: true,

                assignments: [
                    ...assignmentsByOrder.values(),
                ],

                acts: [
                    ...actsByOrder.values(),
                ],
            });


        } catch (error) {
            console.error(
                "Ошибка получения списка договоров:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить список договоров",
            });
        }
    });

router.get("/orders/:orderId/assignment", authenticateToken, async (req, res) => {
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
    });

router.get("/:contractId/file", authenticateToken, async (req, res) => {
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

                        type: {
                            [Op.in]: [
                                "verified_assignment",
                                "verified_completion_act",
                            ],
                        },
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

            const prefix =
                `verified/${contract.type}_` +
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

            const downloadPrefix =
                contract.type === "verified_completion_act"
                    ? "verified-act"
                    : "verified-assignment";

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${downloadPrefix}-${order.id}-v${contract.version}.pdf"`
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
    });

module.exports = router;
