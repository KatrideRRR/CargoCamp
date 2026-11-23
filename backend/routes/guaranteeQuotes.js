"use strict";

const express = require("express");
const router = express.Router();

const authenticateToken = require(
    "../middlewares/userAuth"
);

const {
    buildGuaranteePreview,
} = require("../services/guaranteeQuoteService");

// Только предварительный расчёт.
// Нет обращений к банку, БД и создания платежей.
router.get(
    "/quote",
    authenticateToken,
    (req, res) => {
        // До согласования банка показываем расчёт
        // исключительно в среде разработки.
        if (process.env.NODE_ENV === "production") {
            return res.sendStatus(404);
        }

        res.setHeader(
            "Cache-Control",
            "private, no-store"
        );

        const raw = req.query.workPriceKopecks;

        if (
            typeof raw !== "string" ||
            !/^[1-9]\d{0,7}$/.test(raw)
        ) {
            return res.status(400).json({
                success: false,
                message: "Некорректная сумма",
            });
        }

        try {
            const preview = buildGuaranteePreview(
                Number(raw)
            );

            return res.json({
                success: true,
                ...preview,
            });

        } catch (error) {
            if (error instanceof RangeError) {
                return res.status(422).json({
                    success: false,
                    message: error.message,
                });
            }

            console.error(
                "Guarantee preview error:",
                error?.code || error?.name
            );

            return res.status(500).json({
                success: false,
                message: "Ошибка расчёта",
            });
        }
    }
);

module.exports = router;
