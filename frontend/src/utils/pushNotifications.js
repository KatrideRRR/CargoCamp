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

function buildActiveOrdersUrl({
                                  view = "created",
                                  orderId = "",
                                  orderType = "regular",
                                  reason = "",
                              } = {}) {
    const params = new URLSearchParams();

    params.set("view", view);

    if (orderId) {
        params.set("orderId", String(orderId));
    }

    if (orderType) {
        params.set("orderType", String(orderType));
    }

    if (reason) {
        params.set("reason", String(reason));
    }

    return `/active-orders?${params.toString()}`;
}

function buildMyOrdersUrl({
                              userId = "",
                              orderId = "",
                              reason = "",
                              expand = true,
                          } = {}) {
    const params = new URLSearchParams();

    if (orderId) {
        params.set("orderId", String(orderId));
    }

    if (reason) {
        params.set("reason", String(reason));
    }

    if (expand) {
        params.set("expand", "1");
    }

    return `/my-orders/${userId}?${params.toString()}`;
}

function getAuthToken() {
    return localStorage.getItem("authToken");
}

function parseJwtPayload(token) {
    if (!token || typeof token !== "string") return null;

    try {
        const payload = token.split(".")[1];
        if (!payload) return null;

        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = decodeURIComponent(
            atob(normalized)
                .split("")
                .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
                .join("")
        );

        return JSON.parse(json);
    } catch (e) {
        console.warn("JWT parse error:", e);
        return null;
    }
}

function getCurrentUserId() {
    const userRaw = localStorage.getItem("user");

    try {
        const user = userRaw ? JSON.parse(userRaw) : null;
        if (user?.id) return String(user.id);
    } catch {}

    const token = getAuthToken();
    const payload = parseJwtPayload(token);

    if (payload?.id) return String(payload.id);
    if (payload?.userId) return String(payload.userId);

    return null;
}

function savePendingPushNavigation(rawData) {
    if (!rawData) return;

    try {
        localStorage.setItem(
            "pendingPushNavigation",
            JSON.stringify({
                data: rawData,
                savedAt: Date.now(),
            })
        );
    } catch (e) {
        console.warn("savePendingPushNavigation error:", e);
    }
}

export function consumePendingPushNavigation(navigate) {
    if (!navigate) return false;

    const raw = localStorage.getItem("pendingPushNavigation");
    if (!raw) return false;

    try {
        const parsed = JSON.parse(raw);

        localStorage.removeItem("pendingPushNavigation");

        if (!parsed?.data) return false;

        // защита от очень старых пушей, например старше 10 минут
        const age = Date.now() - Number(parsed.savedAt || 0);
        if (age > 10 * 60 * 1000) {
            return false;
        }

        navigateFromPush(parsed.data, navigate, {
            fromPending: true,
        });

        return true;
    } catch (e) {
        console.warn("consumePendingPushNavigation error:", e);
        localStorage.removeItem("pendingPushNavigation");
        return false;
    }
}

function normalizePushData(raw = {}) {
    const data = { ...(raw || {}) };

    if (typeof data.data === "string") {
        try {
            Object.assign(data, JSON.parse(data.data));
        } catch {}
    }

    if (data.data && typeof data.data === "object") {
        Object.assign(data, data.data);
    }

    return data;
}

function navigateFromPush(rawData, navigate, options = {}) {
    if (!rawData || !navigate) return;

    const data = normalizePushData(rawData);

    const type = data.type;
    const orderId = data.orderId || data.expressOrderId || data.expressId;
    const orderType = data.orderType || "regular";

    const authToken = getAuthToken();
    const currentUserId = getCurrentUserId();

    console.log("NAVIGATE FROM PUSH:", {
        rawData,
        data,
        type,
        orderId,
        orderType,
        hasAuthToken: !!authToken,
        currentUserId,
        options,
    });

    if (!authToken) {
        savePendingPushNavigation(data);
        navigate("/login", {
            replace: true,
            state: {
                fromPush: true,
                reason: type || "push",
            },
        });
        return;
    }
    if (type === "new_message" && orderId) {
        navigate(`/messages/${orderType}/${orderId}`, { replace: true });
        return;
    }

    /*
 * Открыт спор по обычному заказу.
 *
 * Заказчик открывает вкладку созданных заказов.
 * Исполнитель открывает вкладку выполняемых заказов.
 */
    if (type === "dispute_opened" && orderId) {
        const isCurrentUserExecutor =
            currentUserId &&
            data.executorId &&
            Number(currentUserId) === Number(data.executorId);

        const targetView =
            isCurrentUserExecutor
                ? "performing"
                : "created";

        navigate(
            buildActiveOrdersUrl({
                view: targetView,
                orderId,
                orderType: "regular",
                reason: "dispute_opened",
            }),
            {
                replace: true,
            }
        );

        return;
    }

    /*
 * Пользователь получил новый отзыв.
 *
 * Заказ уже завершён, поэтому не отправляем его
 * на active-orders. Открываем страницу его отзывов.
 */
    if (type === "review_received") {
        const reviewedUserId =
            data.reviewedUserId ||
            data.toUserId ||
            data.userId ||
            currentUserId;

        const reviewId =
            data.reviewId ||
            "";

        if (reviewedUserId) {
            const params =
                new URLSearchParams();

            if (reviewId) {
                params.set(
                    "reviewId",
                    String(reviewId)
                );
            }

            if (orderId) {
                params.set(
                    "orderId",
                    String(orderId)
                );
            }

            params.set(
                "reason",
                "review_received"
            );

            const query =
                params.toString();

            navigate(
                `/complaints/${reviewedUserId}${
                    query ? `?${query}` : ""
                }`,
                {
                    replace: true,
                }
            );

            return;
        }

        /*
         * Защита на случай, если userId почему-то
         * не удалось извлечь.
         */
        navigate("/profile", {
            replace: true,
        });

        return;
    }

    if (type === "express_available_nearby") {
        const expressId = data.orderId || data.expressOrderId || data.expressId;

        if (expressId) {
            navigate(`/express-order/${expressId}`, { replace: true });
            return;
        }

        navigate("/orders", { replace: true });
        return;
    }

    if (type === "order_push" && orderId) {
        if (orderType === "express") {
            navigate(`/express-order/${orderId}`, { replace: true });
            return;
        }

        navigate(`/order/${orderId}`, { replace: true });
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

        const currentUserRaw = localStorage.getItem("user");
        let currentUserId = null;

        try {
            const currentUser = currentUserRaw ? JSON.parse(currentUserRaw) : null;
            currentUserId = currentUser?.id ? Number(currentUser.id) : null;
        } catch {}

        const isExecutor =
            currentUserId &&
            data.executorId &&
            Number(data.executorId) === Number(currentUserId);

        navigate(
            buildActiveOrdersUrl({
                view: isExecutor ? "performing" : "created",
                orderId,
                orderType,
                reason: "review_needed",
            }) + "&reviewFromPush=1"
            , { replace: true });

        setTimeout(() => {

            window.dispatchEvent(new CustomEvent("openReviewFromPush"));

        }, 700);

        return;
    }

    /**
     * Заказчик получает такие пуши, когда его заказ уже выполняют.
     * Нужно открыть вкладку "Мои заказы выполняют".
     */
    if (
        [
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
        navigate(
            buildActiveOrdersUrl({
                view: "created",
                orderId,
                orderType,
                reason: type,
            })
            , { replace: true });

        return;
    }

    /**
     * Исполнитель получает это, когда его выбрали.
     * Нужно открыть вкладку "Я выполняю".
     */
    if (type === "order_request_approved") {
        navigate(
            buildActiveOrdersUrl({
                view: "performing",
                orderId,
                orderType,
                reason: type,
            })
        );

        return;
    }

    /**
     * Заказчик получил новый отклик.
     * Его отправляем в "Мои заказы".
     */
    if (type === "order_request") {
        const targetUserId =
            data.creatorId ||
            data.customerId ||
            data.ownerId ||
            data.userId ||
            data.targetUserId ||
            currentUserId;

        if (targetUserId) {
            navigate(
                buildMyOrdersUrl({
                    userId: targetUserId,
                    orderId,
                    reason: "order_request",
                    expand: true,
                }),
                { replace: true }
            );

            return;
        }

        /*
          Важный момент:
          Если authToken есть, но userId не нашли, НЕ отправляем на login.
          Открываем активные/мои созданные заказы.
          Так пользователь хотя бы попадёт в нужный раздел.
        */
        if (authToken) {
            navigate(
                buildActiveOrdersUrl({
                    view: "created",
                    orderId,
                    orderType,
                    reason: "order_request",
                }),
                { replace: true }
            );

            return;
        }

        savePendingPushNavigation(data);
        navigate("/login", {
            replace: true,
            state: {
                fromPush: true,
                reason: "order_request",
            },
        }, { replace: true });

        return;
    }

    if (type === "debt_created") {
        navigate("/profile", { replace: true });
        return;
    }

    /**
     * Fallback.
     * Если тип неизвестный, но это активный express/regular заказ,
     * лучше открыть active-orders, а не профиль.
     */
    if (orderId) {
        navigate(
            buildActiveOrdersUrl({
                view: "created",
                orderId,
                orderType,
                reason: type || "unknown_push",
            })
            , { replace: true });

        return;
    }

    navigate("/profile", { replace: true });
}

function getOrCreatePushDeviceId() {
    const storageKey = "cargocamp_push_device_id";

    let deviceId = localStorage.getItem(storageKey);

    if (deviceId) {
        return deviceId;
    }

    const randomPart =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    deviceId = `${getPushPlatform()}-${randomPart}`;

    localStorage.setItem(storageKey, deviceId);

    return deviceId;
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
            deviceId: getOrCreatePushDeviceId(),
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