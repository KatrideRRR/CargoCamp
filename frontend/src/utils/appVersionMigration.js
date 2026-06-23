const APP_VERSION = process.env.REACT_APP_VERSION || "dev";

const VERSION_KEY = "cargocamp_app_version";

const KEYS_TO_CLEAR_ON_UPDATE = [
    "authToken",
    "user",

    "pendingReviewFromPush",
    "removedOrders",

    "lastPushInitUserId",
    "pushInitialized",

    "toast_shown_notification",
];

export function runAppVersionMigration() {
    const savedVersion = localStorage.getItem(VERSION_KEY);

    if (!savedVersion) {
        localStorage.setItem(VERSION_KEY, APP_VERSION);
        return {
            updated: false,
            firstRun: true,
        };
    }

    if (savedVersion === APP_VERSION) {
        return {
            updated: false,
            firstRun: false,
        };
    }

    console.log("App updated, clearing stale local data", {
        from: savedVersion,
        to: APP_VERSION,
    });

    Object.keys(localStorage).forEach((key) => {
        const shouldClear =
            KEYS_TO_CLEAR_ON_UPDATE.includes(key) ||
            key.startsWith("toast_shown_notification_") ||
            key.startsWith("review_push_opened_");

        if (shouldClear) {
            localStorage.removeItem(key);
        }
    });

    sessionStorage.clear();

    localStorage.setItem(VERSION_KEY, APP_VERSION);

    return {
        updated: true,
        firstRun: false,
        from: savedVersion,
        to: APP_VERSION,
    };
}