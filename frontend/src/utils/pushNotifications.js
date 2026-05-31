import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import axiosInstance from "./axiosInstance";

function getPushPlatform() {
    const p = Capacitor.getPlatform();

    if (p === "ios") return "ios";
    if (p === "android") return "android";

    return "web";
}

function navigateFromPush(data, navigate) {
    if (!data || !navigate) return;

    const type = data.type;
    const orderId = data.orderId;
    const orderType = data.orderType || "regular";

    if (type === "new_message" && orderId) {
        navigate(`/messages/${orderType}/${orderId}`);
        return;
    }

    if (type === "express_available_nearby") {
        const expressId = data.orderId || data.expressOrderId || data.expressId;

        if (expressId) {
            navigate(`/express-order/${expressId}`);
            return;
        }

        navigate("/orders");
        return;
    }

    if (type === "order_push" && orderId) {
        if (orderType === "express") {
            navigate(`/express-order/${orderId}`);
            return;
        }

        navigate(`/order/${orderId}`);
        return;
    }

    if (type === "review_needed" && orderId) {
        localStorage.setItem(
            "pendingReviewFromPush",
            JSON.stringify({
                orderId,
                orderType,
                creatorId: data.creatorId || "",
                executorId: data.executorId || "",
                type,
                openedAt: Date.now(),
            })
        );

        navigate("/active-orders?reviewFromPush=1");
        return;
    }

    if (
        [
            "order_request_approved",
            "order_started",
            "order_completion_requested",
            "order_completed",
            "express_status_changed",
            "express_arrived",
            "express_completed",
            "express_cancelled",
        ].includes(type)
    ) {
        navigate("/active-orders");
        return;
    }

    if (type === "order_request") {
        const userRaw = localStorage.getItem("user");
        try {
            const user = userRaw ? JSON.parse(userRaw) : null;
            if (user?.id) {
                navigate(`/my-orders/${user.id}`);
                return;
            }
        } catch {}

        navigate("/profile");
        return;
    }

    if (type === "debt_created") {
        navigate("/profile");
        return;
    }

    if (orderType === "regular" && orderId) {
        navigate(`/order/${orderId}`);
    }
}

export async function initPushNotifications({ navigate } = {}) {
    if (!Capacitor.isNativePlatform()) {
        console.info("Push: web platform, skip native push init");
        return;
    }

    const token = localStorage.getItem("authToken");
    if (!token) {
        console.info("Push: no auth token, skip");
        return;
    }

    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive !== "granted") {
        permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== "granted") {
        console.warn("Push: permission not granted");
        return;
    }

    let localPerm = await LocalNotifications.checkPermissions();

    if (localPerm.display !== "granted") {
        localPerm = await LocalNotifications.requestPermissions();
    }

    await PushNotifications.removeAllListeners();

    PushNotifications.addListener("registration", async (tokenResult) => {
        try {
            const pushToken = tokenResult.value;

            if (!pushToken) return;

            await axiosInstance.post("/push/register", {
                token: pushToken,
                platform: getPushPlatform(),
                deviceId: `${getPushPlatform()}-${pushToken.slice(0, 16)}`,
                appVersion: process.env.REACT_APP_VERSION || null,
            });

        } catch (e) {
            console.error("Push token register API error:", e);
        }
    });

    PushNotifications.addListener("registrationError", (error) => {
        console.error("Push registration error:", error);
    });

    PushNotifications.addListener("pushNotificationReceived", async (notification) => {
        console.log("Push received foreground:", notification);

        const data = notification?.data || {};
        const type = data.type;

        const title =
            notification?.title ||
            data.title ||
            "CargoCamp";

        const body =
            notification?.body ||
            data.body ||
            data.message ||
            "Новое уведомление";

        // ✅ Показываем локальное системное уведомление,
        // когда приложение открыто
        try {
            await LocalNotifications.schedule({
                notifications: [
                    {
                        id: Date.now() % 2147483647,
                        title,
                        body,
                        extra: data,
                        channelId: "cargocamp_default",
                        sound: "default",
                        schedule: {
                            at: new Date(Date.now() + 100),
                        },
                    },
                ],
            });
        } catch (e) {
            console.error("Local notification foreground error:", e);
        }

        // ✅ Старая логика для отзывов остаётся
        if (type === "review_needed" && data.orderId) {
            localStorage.setItem(
                "pendingReviewFromPush",
                JSON.stringify({
                    orderId: data.orderId,
                    orderType: data.orderType || "regular",
                    creatorId: data.creatorId || "",
                    executorId: data.executorId || "",
                    type: data.type,
                    openedAt: Date.now(),
                })
            );

            window.dispatchEvent(new CustomEvent("openReviewFromPush"));
        }
    });

    LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
        console.log("Local notification action:", action);

        const data = action?.notification?.extra || {};
        navigateFromPush(data, navigate);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        console.log("Push action:", action);

        const data = action?.notification?.data || {};
        navigateFromPush(data, navigate);
    });

    if (Capacitor.getPlatform() === "android") {
        await PushNotifications.createChannel({
            id: "cargocamp_default",
            name: "CargoCamp уведомления",
            description: "Основные уведомления CargoCamp",
            importance: 5,
            visibility: 1,
            sound: "default",
        });
    }

    if (Capacitor.getPlatform() === "android") {
        await LocalNotifications.createChannel({
            id: "cargocamp_default",
            name: "CargoCamp уведомления",
            description: "Основные уведомления CargoCamp",
            importance: 5,
            visibility: 1,
            sound: "default",
        });
    }

    await PushNotifications.register();
}