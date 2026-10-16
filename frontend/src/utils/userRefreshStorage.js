import { Capacitor } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

const REFRESH_TOKEN_KEY = "cargocamp_user_refresh_v1";

export function isNativeCargoCamp() {
    return (
        Capacitor.isNativePlatform() &&
        ["ios", "android"].includes(Capacitor.getPlatform())
    );
}

export async function saveNativeRefreshToken(token) {
    if (!isNativeCargoCamp()) {
        return;
    }

    if (!token || typeof token !== "string") {
        throw new Error("Некорректный refresh-token");
    }

    await SecureStoragePlugin.set({
        key: REFRESH_TOKEN_KEY,
        value: token,
    });
}

export async function getNativeRefreshToken() {
    if (!isNativeCargoCamp()) {
        return null;
    }

    try {
        const result = await SecureStoragePlugin.get({
            key: REFRESH_TOKEN_KEY,
        });

        return result.value || null;
    } catch (error) {
        const message = String(error?.message || "");

        // Отсутствие сохранённого токена — нормальная
        // ситуация при первом запуске приложения.
        if (/not found|not exist|missing/i.test(message)) {
            return null;
        }

        throw error;
    }
}

export async function removeNativeRefreshToken() {
    if (!isNativeCargoCamp()) {
        return;
    }

    try {
        await SecureStoragePlugin.remove({
            key: REFRESH_TOKEN_KEY,
        });
    } catch (error) {
        const message = String(error?.message || "");

        if (!/not found|not exist|missing/i.test(message)) {
            throw error;
        }
    }
}