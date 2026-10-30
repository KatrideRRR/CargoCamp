import { jwtDecode } from "jwt-decode";

const DB_NAME = "cargocamp-chat-offline-v1";
const STORE_NAME = "conversations";

const MAX_MESSAGES = 500;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

let writeQueue = Promise.resolve();

function isCurrentUserKey(key) {
    try {
        const token = localStorage.getItem("authToken");

        if (!token) return false;

        const payload = jwtDecode(token);

        const userId = String(key).split(":")[0];

        return String(payload.id) === userId;
    } catch {
        return false;
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(
                new Error("IndexedDB недоступна")
            );
            return;
        }

        const request = indexedDB.open(
            DB_NAME,
            1
        );

        request.onupgradeneeded = () => {
            const db = request.result;

            if (
                !db.objectStoreNames.contains(
                    STORE_NAME
                )
            ) {
                db.createObjectStore(
                    STORE_NAME,
                    {
                        keyPath: "key",
                    }
                );
            }
        };

        request.onsuccess = () => {
            const db = request.result;

            db.onversionchange = () => {
                db.close();
            };

            resolve(db);
        };

        request.onerror = () => {
            reject(request.error);
        };

        request.onblocked = () => {
            reject(
                new Error("Хранилище заблокировано")
            );
        };
    });
}

async function databaseOperation(
    mode,
    operation
) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        let result;

        try {
            const transaction =
                db.transaction(
                    STORE_NAME,
                    mode
                );

            const store =
                transaction.objectStore(
                    STORE_NAME
                );

            const request = operation(store);

            request.onsuccess = () => {
                result = request.result;
            };

            transaction.oncomplete = () => {
                db.close();
                resolve(result);
            };

            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };

            transaction.onabort = () => {
                db.close();
                reject(
                    transaction.error ||
                    new Error("Транзакция отменена")
                );
            };
        } catch (error) {
            db.close();
            reject(error);
        }
    });
}

function enqueueWrite(operation) {
    const task = writeQueue
        .catch(() => {})
        .then(operation);

    writeQueue = task.catch(() => {});

    return task;
}

function prepareMessage(message) {
    const fields = [
        "id",
        "clientMessageId",
        "senderId",
        "receiverId",
        "orderId",
        "orderType",
        "content",
        "createdAt",
        "updatedAt",
    ];

    const result = {};

    for (const field of fields) {
        if (message[field] !== undefined) {
            result[field] = message[field];
        }
    }

    return result;
}

export async function readChatOffline(key) {
    if (!isCurrentUserKey(key)) {
        return null;
    }

    const record =
        await databaseOperation(
            "readonly",
            (store) => store.get(key)
        );

    if (!isCurrentUserKey(key)) {
        return null;
    }

    if (!record) return null;

    if (
        Date.now() - record.updatedAt >
        MAX_AGE
    ) {
        return null;
    }

    return {
        messages: Array.isArray(record.messages)
            ? record.messages
            : [],

        cursor:
            Number.isSafeInteger(record.cursor)
                ? record.cursor
                : 0,
    };
}

export function saveChatOffline(
    key,
    snapshot
) {
    const record = {
        key,

        cursor:
            Number.isSafeInteger(snapshot.cursor)
                ? snapshot.cursor
                : 0,

        messages: (
            Array.isArray(snapshot.messages)
                ? snapshot.messages
                : []
        )
            .slice(-MAX_MESSAGES)
            .filter((message) => message?.id != null)
            .map(prepareMessage),

        updatedAt: Date.now(),
    };

    return enqueueWrite(async () => {
        // Проверяем аккаунт непосредственно
        // перед записью.
        if (!isCurrentUserKey(key)) {
            return;
        }

        await databaseOperation(
            "readwrite",
            (store) => store.put(record)
        );
    });
}

export function clearAllChatOffline() {
    return enqueueWrite(async () => {
        await databaseOperation(
            "readwrite",
            (store) => store.clear()
        );
    });
}