import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export async function getCurrentLocation(options = {}) {
    const platform = Capacitor.getPlatform();

    const finalOptions = {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
        ...options,
    };

    if (platform === "android" || platform === "ios") {
        try {
            const currentPermissions = await Geolocation.checkPermissions();

            if (
                currentPermissions.location !== "granted" &&
                currentPermissions.coarseLocation !== "granted"
            ) {
                const requested = await Geolocation.requestPermissions({
                    permissions: ["location"],
                });

                if (
                    requested.location !== "granted" &&
                    requested.coarseLocation !== "granted"
                ) {
                    throw new Error("LOCATION_PERMISSION_DENIED");
                }
            }

            const position = await Geolocation.getCurrentPosition(finalOptions);

            return {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                source: "capacitor",
            };
        } catch (error) {
            console.error("Capacitor GPS error:", error);

            const code = error?.code || error?.message;

            if (code === "OS-PLUG-GLOC-0007") {
                throw new Error("LOCATION_SERVICES_DISABLED");
            }

            if (code === "OS-PLUG-GLOC-0010") {
                throw new Error("LOCATION_TIMEOUT");
            }

            if (code === "OS-PLUG-GLOC-0003" || code === "LOCATION_PERMISSION_DENIED") {
                throw new Error("LOCATION_PERMISSION_DENIED");
            }

            throw error;
        }
    }

    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("GEOLOCATION_NOT_SUPPORTED"));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    source: "browser",
                });
            },
            (error) => {
                console.error("Browser GPS error:", error);
                reject(error);
            },
            finalOptions
        );
    });
}

export function getLocationErrorMessage(error) {
    const message = error?.message || error?.code || "";

    if (message === "LOCATION_PERMISSION_DENIED") {
        return "Нет разрешения на геолокацию. Проверьте разрешение для приложения в настройках телефона.";
    }

    if (message === "LOCATION_SERVICES_DISABLED") {
        return "Геолокация выключена на телефоне. Включите GPS/Местоположение и попробуйте снова.";
    }

    if (message === "LOCATION_TIMEOUT") {
        return "Не удалось получить координаты вовремя. Попробуйте выйти на улицу или включить точную геолокацию.";
    }

    if (message === "GEOLOCATION_NOT_SUPPORTED") {
        return "Геолокация недоступна на этом устройстве.";
    }

    return "Не удалось определить местоположение по GPS.";
}