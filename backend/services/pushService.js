const { PushToken } = require("../models");
const { initFirebaseAdmin } = require("../config/firebaseAdmin");

function stringifyData(data = {}) {
    const out = {};

    Object.entries(data || {}).forEach(([key, value]) => {
        if (value === null || value === undefined) return;

        if (typeof value === "string") {
            out[key] = value;
        } else {
            out[key] = JSON.stringify(value);
        }
    });

    return out;
}

async function deactivateBadTokens(badTokens = []) {
    if (!badTokens.length) return;

    await PushToken.update(
        { isActive: false },
        {
            where: {
                token: badTokens,
            },
        }
    );
}

async function sendPushToUser({
                                  userId,
                                  title,
                                  body,
                                  data = {},
                              }) {
    if (!userId) return;

    const admin = initFirebaseAdmin();
    if (!admin) return;

    const rows = await PushToken.findAll({
        where: {
            userId,
            isActive: true,
        },
        attributes: ["id", "token", "platform"],
    });

    const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];

    if (!tokens.length) return;

    const messageBase = {
        notification: {
            title: title || "CargoCamp",
            body: body || "Новое уведомление",
        },

        data: stringifyData({
            ...data,
            click_action: "OPEN_APP",
        }),

        android: {
            priority: "high",
            notification: {
                channelId: "cargocamp_default",
                sound: "default",
            },
        },

        apns: {
            payload: {
                aps: {
                    sound: "default",
                },
            },
        },
    };

    const badTokens = [];

    const messages = tokens.map((token) => ({
        ...messageBase,
        token,
    }));

    try {
        const response = await admin.messaging().sendEach(messages);

        response.responses.forEach((r, idx) => {
            if (!r.success) {
                const code = r.error?.code || "";

                if (
                    code.includes("registration-token-not-registered") ||
                    code.includes("invalid-registration-token") ||
                    code.includes("invalid-argument")
                ) {
                    badTokens.push(tokens[idx]);
                }

                console.error("push send error:", code, r.error?.message);
            }
        });

        await deactivateBadTokens(badTokens);

        return {
            successCount: response.successCount,
            failureCount: response.failureCount,
        };
    } catch (e) {
        console.error("sendPushToUser error:", e);
        return null;
    }
}

module.exports = {
    sendPushToUser,
};