
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { contractsRoot } = require("../config/storagePaths");

const MAX_PHOTOS = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024;

const MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
]);

const evidenceRoot = path.join(contractsRoot, "dispute-evidence");

function errorWithStatus(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function getDisputeDirectory(disputeId) {
    const id = Number(disputeId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw errorWithStatus("Некорректный спор");
    }

    return path.join(evidenceRoot, String(id));
}

async function saveDisputeEvidence(disputeId, userId, files = []) {
    if (!files.length) return [];

    if (files.length > MAX_PHOTOS) {
        throw errorWithStatus("Можно прикрепить не более 5 фотографий");
    }

    const directory = getDisputeDirectory(disputeId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });

    const evidence = [];

    try {
        for (const file of files) {
            if (!MIME_TYPES.has(file.mimetype)) {
                throw errorWithStatus("Неподдерживаемый формат фотографии");
            }

            if (file.size > MAX_FILE_SIZE) {
                throw errorWithStatus("Фотография превышает 8 МБ", 413);
            }

            let buffer;

            try {
                buffer = await sharp(file.buffer, {
                    limitInputPixels: 25_000_000,
                    failOn: "error",
                })
                    .rotate()
                    .jpeg({ quality: 85 })
                    .toBuffer();
            } catch {
                throw errorWithStatus(
                    "Не удалось обработать фотографию. Используйте JPG, PNG или WebP"
                );
            }

            const id = crypto.randomUUID();
            const fileName = `${id}.jpg`;

            await fs.writeFile(
                path.join(directory, fileName),
                buffer,
                { flag: "wx", mode: 0o600 }
            );

            evidence.push({
                id,
                uploadedById: Number(userId),
                mimeType: "image/jpeg",
                size: buffer.length,
                sha256: crypto
                    .createHash("sha256")
                    .update(buffer)
                    .digest("hex"),
                createdAt: new Date().toISOString(),
            });
        }

        return evidence;
    } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
    }
}

async function removeDisputeEvidence(disputeId) {
    await fs.rm(getDisputeDirectory(disputeId), {
        recursive: true,
        force: true,
    });
}

function getEvidenceFilePath(disputeId, photoId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(photoId))) {
        throw errorWithStatus("Фотография не найдена", 404);
    }

    return path.join(
        getDisputeDirectory(disputeId),
        `${photoId}.jpg`
    );
}

module.exports = {
    MAX_PHOTOS,
    MAX_FILE_SIZE,
    saveDisputeEvidence,
    removeDisputeEvidence,
    getEvidenceFilePath,
};
