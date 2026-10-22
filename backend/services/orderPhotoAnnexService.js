
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const {
    ordersRoot,
} = require("../config/storagePaths");

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS = 50;

const GROUPS = [
    {
        field: "images",
        title: "Фото при создании заказа",
        stages: ["assignment", "completion"],
    },
    {
        field: "customerBeforePhotos",
        title: "Фото ДО — заказчик",
        stages: ["assignment", "completion"],
    },
    {
        field: "executorBeforePhotos",
        title: "Фото ДО — исполнитель",
        stages: ["assignment", "completion"],
    },
    {
        field: "customerAfterPhotos",
        title: "Фото ПОСЛЕ — заказчик",
        stages: ["completion"],
    },
    {
        field: "executorAfterPhotos",
        title: "Фото ПОСЛЕ — исполнитель",
        stages: ["completion"],
    },
];

function photoArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            throw new Error(
                "Некорректный список фотографий заказа"
            );
        }
    }

    return [];
}

function hash(buffer) {
    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");
}

async function readPhoto({
                             orderId,
                             url,
                             canonicalDirectory,
                         }) {
    if (typeof url !== "string") {
        throw new Error(
            "Некорректная ссылка на фотографию"
        );
    }

    /*
     * Разрешаем только фотографии именно
     * этого заказа из локального хранилища.
     *
     * Никаких HTTP-запросов, file://,
     * произвольных путей и соседних заказов.
     */
    const match = /^\/uploads\/orders\/order_(\d+)\/([a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp))$/i
        .exec(url);

    if (
        !match ||
        Number(match[1]) !== orderId
    ) {
        throw new Error(
            "Недопустимый путь фотографии заказа"
        );
    }

    const absolutePath = path.join(
        canonicalDirectory,
        match[2]
    );

    const realPath =
        await fs.realpath(absolutePath);

    if (
        path.dirname(realPath) !==
        canonicalDirectory
    ) {
        throw new Error(
            "Фотография находится вне каталога заказа"
        );
    }

    const stat = await fs.stat(realPath);

    if (
        !stat.isFile() ||
        stat.size === 0 ||
        stat.size > MAX_FILE_BYTES
    ) {
        throw new Error(
            "Некорректный размер фотографии"
        );
    }

    const original = await fs.readFile(realPath);
    const sourceSha256 = hash(original);

    /*
     * В PDF кладём уменьшенную JPEG-копию.
     *
     * limitInputPixels защищает от
     * изображений с чрезмерным разрешением.
     *
     * Метаданные оригинала в JPEG-копию
     * не переносим.
     */
    const preview = await sharp(original, {
        limitInputPixels: 30000000,
        failOn: "error",
    })
        .rotate()
        .resize({
            width: 900,
            height: 700,
            fit: "inside",
            withoutEnlargement: true,
        })
        .jpeg({
            quality: 72,
            mozjpeg: true,
        })
        .toBuffer();

    return {
        source: url,
        sourceSha256,
        previewSha256: hash(preview),
        sourceBytes: original.length,

        dataUri:
            `data:image/jpeg;base64,` +
            preview.toString("base64"),
    };
}

async function collectOrderPhotoAnnex(
    order,
    stage = "completion"
) {
    const orderId = Number(order?.id);

    if (
        !Number.isSafeInteger(orderId) ||
        orderId <= 0
    ) {
        throw new Error(
            "Некорректный ID заказа"
        );
    }

    if (
        !["assignment", "completion"]
            .includes(stage)
    ) {
        throw new Error(
            "Некорректный этап фотоприложения"
        );
    }

    const candidates = GROUPS
        .filter((group) =>
            group.stages.includes(stage)
        )
        .map((group) => ({
            ...group,
            urls: photoArray(order[group.field]),
        }));

    const count = candidates.reduce(
        (sum, group) => sum + group.urls.length,
        0
    );

    if (count > MAX_PHOTOS) {
        throw new Error(
            `Превышен лимит фотографий для PDF: ${count}`
        );
    }

    if (count === 0) {
        return {
            sections: [],
            manifest: [],
        };
    }

    const expectedDirectory = path.join(
        ordersRoot,
        `order_${orderId}`
    );

    const canonicalDirectory =
        await fs.realpath(expectedDirectory);

    const canonicalOrdersRoot =
        await fs.realpath(ordersRoot);

    if (
        path.dirname(canonicalDirectory) !==
        canonicalOrdersRoot
    ) {
        throw new Error(
            "Недопустимое расположение каталога заказа"
        );
    }

    const sections = [];
    const manifest = [];

    for (const group of candidates) {
        if (group.urls.length === 0) {
            continue;
        }

        const photos = [];

        for (const url of group.urls) {
            photos.push(
                await readPhoto({
                    orderId,
                    url,
                    canonicalDirectory,
                })
            );
        }

        sections.push({
            field: group.field,
            title: group.title,
            photos,
        });

        /*
         * В JSON базы не сохраняем base64.
         * Только ссылки и контрольные суммы.
         */
        manifest.push({
            field: group.field,
            title: group.title,

            photos: photos.map((photo) => ({
                source: photo.source,
                sourceSha256:
                photo.sourceSha256,
                previewSha256:
                photo.previewSha256,
                sourceBytes:
                photo.sourceBytes,
            })),
        });
    }

    return {
        sections,
        manifest,
    };
}

module.exports = {
    collectOrderPhotoAnnex,
};
