"use strict";

const express = require("express");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    getConsentDocument,
} = require(
    "../services/personalDataConsentService"
);

const router = express.Router();

router.get(
    "/:code",
    authenticateToken,
    (req, res) => {
        const code = String(
            req.params.code || ""
        );

        const document =
            getConsentDocument(code);

        if (!document) {
            return res.status(404).json({
                success: false,
                message:
                    "Документ согласия не найден",
            });
        }

        return res.json({
            success: true,
            document,
        });
    }
);

module.exports = router;