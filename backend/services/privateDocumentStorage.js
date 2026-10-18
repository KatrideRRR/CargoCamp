const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const MAGIC = Buffer.from("CCDOC1");
const IV_SIZE = 12;
const TAG_SIZE = 16;

function getConfiguration() {
    const root = process.env.PRIVATE_DOCUMENTS_DIR;
    const keyHex = process.env.PRIVATE_DOCUMENTS_KEY_HEX;

    if (!root || !path.isAbsolute(root)) {
        throw new Error(
            "PRIVATE_DOCUMENTS_DIR должен быть абсолютным путём"
        );
    }

    if (!/^[0-9a-f]{64}$/i.test(keyHex || "")) {
        throw new Error(
            "PRIVATE_DOCUMENTS_KEY_HEX должен содержать 64 hex-символа"
        );
    }

    const resolvedRoot = path.resolve(root);

    const publicRoots = [
        path.resolve(__dirname, "../uploads"),
        path.resolve(__dirname, "../contracts"),
    ];

    for (const publicRoot of publicRoots) {
        if (
            resolvedRoot === publicRoot ||
            resolvedRoot.startsWith(publicRoot + path.sep)
        ) {
            throw new Error(
                "Приватное хранилище не может находиться в публичной директории"
            );
        }
    }

    return {
        root: resolvedRoot,
        key: Buffer.from(keyHex, "hex"),
    };
}

function detectDocumentType(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error("Некорректный файл");
    }

    if (
        buffer.length === 0 ||
        buffer.length > MAX_FILE_SIZE
    ) {
        throw new Error("Недопустимый размер документа");
    }

    if (
        buffer.subarray(0, 5).toString("ascii") === "%PDF-"
    ) {
        return {
            mimeType: "application/pdf",
            extension: ".pdf",
        };
    }

    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return {
            mimeType: "image/jpeg",
            extension: ".jpg",
        };
    }

    const pngSignature = Buffer.from(
        "89504e470d0a1a0a",
        "hex"
    );

    if (
        buffer.subarray(0, 8).equals(pngSignature)
    ) {
        return {
            mimeType: "image/png",
            extension: ".png",
        };
    }

    throw new Error(
        "Поддерживаются только PDF, JPEG и PNG"
    );
}

function validateStorageKey(storageKey) {
    if (
        typeof storageKey !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/i.test(
            storageKey
        )
    ) {
        throw new Error("Некорректный ключ документа");
    }
}

async function savePrivateDocument(buffer) {
    const configuration = getConfiguration();

    const documentType = detectDocumentType(buffer);

    await fs.mkdir(configuration.root, {
        recursive: true,
        mode: 0o700,
    });

    const storageKey = `${crypto.randomUUID()}.bin`;

    const iv = crypto.randomBytes(IV_SIZE);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        configuration.key,
        iv
    );

    cipher.setAAD(Buffer.from(storageKey));

    const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    const payload = Buffer.concat([
        MAGIC,
        iv,
        authTag,
        encrypted,
    ]);

    const filePath = path.join(
        configuration.root,
        storageKey
    );

    await fs.writeFile(filePath, payload, {
        flag: "wx",
        mode: 0o600,
    });

    return {
        storageKey,
        fileHash: crypto
            .createHash("sha256")
            .update(buffer)
            .digest("hex"),
        fileSize: buffer.length,
        mimeType: documentType.mimeType,
        extension: documentType.extension,
        isEncrypted: true,
    };
}

async function readPrivateDocument(storageKey) {
    validateStorageKey(storageKey);

    const configuration = getConfiguration();

    const filePath = path.join(
        configuration.root,
        storageKey
    );

    const payload = await fs.readFile(filePath);

    const headerSize =
        MAGIC.length + IV_SIZE + TAG_SIZE;

    if (
        payload.length <= headerSize ||
        !payload.subarray(0, MAGIC.length).equals(MAGIC)
    ) {
        throw new Error("Повреждённый формат документа");
    }

    let offset = MAGIC.length;

    const iv = payload.subarray(
        offset,
        offset + IV_SIZE
    );

    offset += IV_SIZE;

    const authTag = payload.subarray(
        offset,
        offset + TAG_SIZE
    );

    offset += TAG_SIZE;

    const encrypted = payload.subarray(offset);

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        configuration.key,
        iv
    );

    decipher.setAAD(Buffer.from(storageKey));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
    ]);

    const documentType =
        detectDocumentType(decrypted);

    return {
        buffer: decrypted,
        mimeType: documentType.mimeType,
        extension: documentType.extension,

        fileHash: crypto
            .createHash("sha256")
            .update(decrypted)
            .digest("hex"),
    };
}

async function deletePrivateDocument(storageKey) {
    validateStorageKey(storageKey);

    const configuration = getConfiguration();

    await fs.rm(
        path.join(configuration.root, storageKey),
        { force: true }
    );
}

module.exports = {
    savePrivateDocument,
    readPrivateDocument,
    deletePrivateDocument,
};