const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const authenticateToken = require("../middlewares/userAuth");
const { PushToken } = require("../models");

function makeTokenHash(token) {
    return crypto
        .createHash("sha256")
        .update(String(token))
        .digest("hex");
}

router.post("/register", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            token,
            platform = "android",
            deviceId = null,
            appVersion = null,
        } = req.body;

        if (!token || typeof token !== "string") {
            return res.status(400).json({
                success: false,
                message: "Push token is required",
            });
        }

        const safePlatform = ["ios", "android", "web"].includes(platform)
            ? platform
            : "android";

        const tokenHash = makeTokenHash(token);

        const [row, created] = await PushToken.findOrCreate({
            where: {
                tokenHash,
            },
            defaults: {
                userId,
                token,
                tokenHash,
                platform: safePlatform,
                deviceId,
                appVersion,
                isActive: true,
                lastSeenAt: new Date(),
            },
        });

        if (!created) {
            await row.update({
                userId,
                token,
                tokenHash,
                platform: safePlatform,
                deviceId,
                appVersion,
                isActive: true,
                lastSeenAt: new Date(),
            });
        }

        return res.json({
            success: true,
        });
    } catch (e) {
        console.error("push register error:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка регистрации push-token",
        });
    }
});

router.post("/unregister", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { token } = req.body;

        if (!token || typeof token !== "string") {
            return res.status(400).json({
                success: false,
                message: "Push token is required",
            });
        }

        const tokenHash = makeTokenHash(token);

        await PushToken.update(
            {
                isActive: false,
                lastSeenAt: new Date(),
            },
            {
                where: {
                    userId,
                    tokenHash,
                },
            }
        );

        return res.json({
            success: true,
        });
    } catch (e) {
        console.error("push unregister error:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка удаления push-token",
        });
    }
});

module.exports = router;