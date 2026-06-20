import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { LocalNotifications } from "@capacitor/local-notifications";
import axiosInstance from "./axiosInstance";

let pushInitialized = false;
let pushInitializing = false;
let pushInitializedUserId = null;
let lastSavedPushToken = null;

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
            "order_completion_reminder",
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

async function savePushTokenToBackend(pushToken) {
    if (!pushToken) {
        console.warn("Push token empty");
        return;
    }

    if (lastSavedPushToken === pushToken) {
        console.log("Push token already saved in this session, skip");
        return;
    }

    const platform = getPushPlatform();

    const res = await axiosInstance.post("/push/register", {
        token: pushToken,
        platform,
        deviceId: `${platform}-${pushToken.slice(0, 16)}`,
        appVersion: process.env.REACT_APP_VERSION || null,
    });

    lastSavedPushToken = pushToken;

    console.log("Push token saved:", res.data);
}

export async function initPushNotifications({ navigate, userId } = {}) {
    const normalizedUserId = userId ? String(userId) : null;

    if (pushInitialized && pushInitializedUserId === normalizedUserId) {
        console.log("Push already initialized for this user, skip", {
            userId: normalizedUserId,
        });
        return;
    }

    if (pushInitializing) {
        console.log("Push already initializing, skip");
        return;
    }

    if (!Capacitor.isNativePlatform()) {
        console.info("Push: web platform, skip native push init");
        return;
    }

    const authToken = localStorage.getItem("authToken");

    if (!authToken) {
        console.info("Push: no auth token, skip");
        return;
    }

    pushInitializing = true;

    try {
        const platform = getPushPlatform();

        console.log("FirebaseMessaging init start", {
            platform,
            isNative: Capacitor.isNativePlatform(),
            hasToken: !!authToken,
            userId: normalizedUserId,
        });

        const supported = await FirebaseMessaging.isSupported();

        if (supported && supported.isSupported === false) {
            console.warn("FirebaseMessaging is not supported");
            return;
        }

        let permStatus = await FirebaseMessaging.checkPermissions();

        if (permStatus.receive !== "granted") {
            permStatus = await FirebaseMessaging.requestPermissions();
        }

        if (permStatus.receive !== "granted") {
            console.warn("FirebaseMessaging permission not granted", permStatus);
            return;
        }

        let localPerm = await LocalNotifications.checkPermissions();

        if (localPerm.display !== "granted") {
            localPerm = await LocalNotifications.requestPermissions();
        }

        await FirebaseMessaging.removeAllListeners();

        await FirebaseMessaging.addListener("tokenReceived", async (event) => {
            try {
                console.log("FirebaseMessaging tokenReceived:", {
                    tokenLen: event?.token?.length,
                    tokenStart: event?.token?.slice(0, 25),
                });

                await savePushTokenToBackend(event.token);
            } catch (e) {
                console.error(
                    "FirebaseMessaging tokenReceived save error:",
                    e?.response?.data || e.message || e
                );
            }
        });

        await FirebaseMessaging.addListener("notificationReceived", async (event) => {
            console.log("FirebaseMessaging notificationReceived foreground:", event);

            const notification = event?.notification || {};
            const data = notification?.data || {};

            const title =
                notification?.title ||
                data.title ||
                "CargoCamp";

            const body =
                notification?.body ||
                data.body ||
                data.message ||
                "Новое уведомление";

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

            if (data.type === "review_needed" && data.orderId) {
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

        await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
            console.log("FirebaseMessaging notificationActionPerformed:", event);

            const notification = event?.notification || {};
            const data = notification?.data || {};

            navigateFromPush(data, navigate);
        });

        await LocalNotifications.removeAllListeners();

        await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
            console.log("Local notification action:", action);

            const data = action?.notification?.extra || {};
            navigateFromPush(data, navigate);
        });

        if (platform === "android") {
            await FirebaseMessaging.createChannel({
                id: "cargocamp_default",
                name: "CargoCamp уведомления",
                description: "Основные уведомления CargoCamp",
                importance: 5,
                visibility: 1,
                sound: "default",
            });

            await LocalNotifications.createChannel({
                id: "cargocamp_default",
                name: "CargoCamp уведомления",
                description: "Основные уведомления CargoCamp",
                importance: 5,
                visibility: 1,
                sound: "default",
            });
        }

        const tokenResult = await FirebaseMessaging.getToken();

        console.log("FirebaseMessaging getToken result:", {
            tokenLen: tokenResult?.token?.length,
            tokenStart: tokenResult?.token?.slice(0, 25),
        });

        await savePushTokenToBackend(tokenResult.token);

        pushInitialized = true;
        pushInitializedUserId = normalizedUserId;
    } catch (error) {
        console.error("FirebaseMessaging init error:", error);
        pushInitialized = false;
        pushInitializedUserId = null;
    } finally {
        pushInitializing = false;
    }
}