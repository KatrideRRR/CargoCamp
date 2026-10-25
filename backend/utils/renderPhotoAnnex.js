
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderPhotoAnnex(annex) {
    if (
        !annex ||
        !Array.isArray(annex.sections) ||
        annex.sections.length === 0
    ) {
        return "";
    }

    const renderFigure = (photo, index) => `
        <figure style="
            margin: 12px 0;
            padding: 10px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            break-inside: avoid;
            page-break-inside: avoid;
        ">
            <img
                src="${photo.dataUri}"
                alt="Фото ${index + 1}"
                style="
                    display: block;
                    width: auto;
                    max-width: 100%;
                    max-height: 235px;
                    object-fit: contain;
                    margin: 0 auto 8px;
                "
            />

            <figcaption style="
                font-size: 10px;
                line-height: 1.45;
                overflow-wrap: anywhere;
            ">
                <strong>Фото ${index + 1}</strong>

                <div>
                    Источник:
                    ${escapeHtml(photo.source)}
                </div>

                <div>
                    SHA-256 оригинала:
                    ${escapeHtml(photo.sourceSha256)}
                </div>

                <div>
                    SHA-256 миниатюры:
                    ${escapeHtml(photo.previewSha256)}
                </div>
            </figcaption>
        </figure>
    `;

    const sections = annex.sections
        .filter((section) =>
            Array.isArray(section.photos) &&
            section.photos.length > 0
        )
        .map((section) => {
            const figures = section.photos.map(renderFigure);
            const [firstFigure, ...otherFigures] = figures;

            return `
                <div style="margin-top: 18px;">
                    <div style="
                        break-inside: avoid;
                        page-break-inside: avoid;
                    ">
                        <h3 style="
                            font-size: 14px;
                            margin-bottom: 8px;
                        ">
                            ${escapeHtml(section.title)}
                        </h3>

                        ${firstFigure}
                    </div>

                    ${otherFigures.join("")}
                </div>
            `;
        })
        .join("");

    return `
        <div style="
            page-break-before: always;
            break-before: page;
            font-family: Arial, sans-serif;
            color: #172033;
        ">
            <h2 style="font-size: 19px;">
                Фотоприложение
            </h2>

            <p style="
                font-size: 11px;
                line-height: 1.6;
                color: #64748b;
            ">
                Фотографии включены в PDF
                в виде уменьшенных копий.

                Для каждого изображения сохранены
                контрольные суммы исходного файла
                и встроенной миниатюры.
            </p>

            ${sections}
        </div>
    `;
}

module.exports = renderPhotoAnnex;
