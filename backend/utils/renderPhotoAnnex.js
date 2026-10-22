
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

    const sections = annex.sections
        .map((section) => {
            const photos = section.photos.map(
                (photo, index) => `
                    <figure style="
                        margin: 14px 0;
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
                                max-height: 260px;
                                object-fit: contain;
                                margin: 0 auto 10px;
                            "
                        />

                        <figcaption style="
                            font-size: 10px;
                            line-height: 1.5;
                            overflow-wrap: anywhere;
                        ">
                            <strong>
                                Фото ${index + 1}
                            </strong>

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
                `
            ).join("");

            return `
                <section style="margin-top: 20px;">
                    <h3 style="font-size: 15px;">
                        ${escapeHtml(section.title)}
                    </h3>

                    ${photos}
                </section>
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
                Снимки включены в данный PDF
                на момент формирования документа.

                Фотографии представлены
                уменьшенными копиями.

                Контрольные суммы SHA-256
                относятся к исходным файлам
                и встроенным миниатюрам.
            </p>

            ${sections}
        </div>
    `;
}

module.exports = renderPhotoAnnex;
