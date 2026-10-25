
const puppeteer = require("puppeteer");
const renderPhotoAnnex = require("./renderPhotoAnnex");

function escapeHtml(value) {
    return String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDate(value) {
    if (!value) return "Не указано";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "Не указано"
        : date.toLocaleString("ru-RU", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
}

function money(value) {
    const kopecks = Number(value);

    if (!Number.isFinite(kopecks)) return "—";

    return (kopecks / 100).toLocaleString(
        "ru-RU",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    ) + " ₽";
}

function renderHtml(data, photoAnnex) {
    const row = (label, value) => `
        <div class="row">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(value)}</span>
        </div>
    `;

    const details = Array.isArray(data.serviceDetailRows)
        ? data.serviceDetailRows
        : [];

    const addenda = Array.isArray(data.addenda)
        ? data.addenda
        : [];

    const disputes = Array.isArray(data.disputes)
        ? data.disputes
        : [];

    // Поддерживаем также ранее созданные снимки актов.
    const legacyPrice = Math.round(
        Number(data.priceRub || 0) * 100
    );

    const originalPrice =
        data.originalPriceKopecks ?? legacyPrice;

    const finalPrice =
        data.finalPriceKopecks ?? legacyPrice;

    const paymentLabels = {
        cash: "Наличными",
        guarantee: "Гарантийная сделка",
        installment: "Рассрочка",
    };

    const paymentType =
        paymentLabels[data.paymentType] ||
        data.paymentType ||
        "Не указан";

    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: Arial, sans-serif;
        color: #172033;
        font-size: 12px;
        line-height: 1.55;
        padding: 14px;
    }

    h1 {
        font-size: 21px;
        margin: 0 0 5px;
    }

    h2 {
        font-size: 15px;
        margin: 25px 0 12px;
        break-after: avoid;
        page-break-after: avoid;
    }

    h3 {
        font-size: 13px;
        margin: 0 0 8px;
    }

    .subtitle {
        color: #64748b;
        margin-bottom: 20px;
    }

    .notice, .summary {
        padding: 14px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        border-radius: 9px;
        margin: 14px 0;
    }

    .parties {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .party {
        min-width: 0;
        padding: 14px;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        background: #f8fafc;
    }

    .party strong {
        display: block;
        overflow-wrap: anywhere;
    }

    .party small {
        display: block;
        margin-top: 6px;
        color: #64748b;
    }

    .row {
        display: flex;
        gap: 14px;
        padding: 8px 0;
        border-bottom: 1px solid #e2e8f0;
        break-inside: avoid;
    }

    .row strong {
        flex: 0 0 175px;
    }

    .row span {
        min-width: 0;
        flex: 1;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .entry {
        border: 1px solid #dbe3ef;
        border-radius: 9px;
        padding: 13px;
        margin: 13px 0;
    }

    .entry-title {
        font-weight: bold;
        margin-bottom: 7px;
    }

    .work {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        margin: 10px 0;
    }

    .muted {
        color: #64748b;
    }

    .warning {
        padding: 14px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        border-radius: 9px;
        margin-top: 22px;
    }

    .footer {
        font-size: 10px;
        color: #64748b;
        margin-top: 24px;
    }

    .hash {
        font-size: 9px;
        overflow-wrap: anywhere;
    }
</style>
</head>
<body>

<h1>АКТ О ЗАВЕРШЕНИИ ЗАКАЗА</h1>

<div class="subtitle">
    CargoCamp · Заказ №${escapeHtml(data.orderId)}
    · Версия ${escapeHtml(data.version)}
</div>

<div class="notice">
    <strong>Электронный документ CargoCamp.</strong>
    Статус приёмки и электронной подписи определяется
    по отдельным записям системы, связанным
    с контрольной суммой данного PDF.
    Сформированный документ не подписывается автоматически.
</div>

<h2>1. Сведения о документе</h2>

${row("Номер акта", data.documentNumber)}
${row("Основной договор", data.assignmentNumber)}
${row("Дата формирования", formatDate(data.generatedAt))}

<div class="hash">
    SHA-256 основного договора:
    ${escapeHtml(data.assignmentHash)}
</div>

<h2>2. Участники</h2>

<div class="parties">
    <div class="party">
        <h3>Заказчик</h3>
        <strong>${escapeHtml(data.customerName)}</strong>
        <small>ID пользователя: ${escapeHtml(data.customerId)}</small>
    </div>

    <div class="party">
        <h3>Исполнитель</h3>
        <strong>${escapeHtml(data.executorName)}</strong>
        <small>ID пользователя: ${escapeHtml(data.executorId)}</small>
    </div>
</div>

<h2>3. Первоначальное задание</h2>

${row("Категория", data.category)}
${row("Подкатегория", data.subcategory)}
${row("Услуга", data.service || "—")}
${row("Основной адрес", data.address)}
${row("Описание", data.description)}

${row(
        "Запланированное время",
        data.isAsap
            ? "Как можно скорее"
            : formatDate(data.plannedTime)
    )}

${details.length ? `
<h3 style="margin-top: 15px;">
    Дополнительные параметры заказа
</h3>

${details.map((item) =>
        row(item.label, item.value)
    ).join("")}
` : ""}

<h2>4. Согласованная стоимость</h2>

${row("Первоначальная стоимость", money(originalPrice))}

${addenda.map((item) => `
    <div class="entry">
        <div class="entry-title">
            Дополнительное соглашение
            ${escapeHtml(item.documentNumber)}
        </div>

        <div class="work">
            ${escapeHtml(item.additionalWork)}
        </div>

        ${row("Стоимость до изменения", money(item.beforePriceKopecks))}
        ${row("Стоимость после изменения", money(item.afterPriceKopecks))}
        ${row("Подписано обеими сторонами", formatDate(item.signedAt))}

        <div class="hash">
            SHA-256 соглашения:
            ${escapeHtml(item.documentHash)}
        </div>
    </div>
`).join("")}

<div class="summary">
    <strong>Итоговая согласованная стоимость:</strong>
    ${escapeHtml(money(finalPrice))}
</div>

${row("Способ оплаты", paymentType)}

<div class="muted">
    Указанная стоимость является согласованной стоимостью
    заказа. Этот акт сам по себе не подтверждает факт
    передачи или получения денежных средств.
</div>

<h2>5. Фактическое выполнение</h2>

${row("Начало выполнения", formatDate(data.workStartedAt))}
${row("Окончание выполнения", formatDate(data.workEndedAt))}
${row("Завершение заказа", formatDate(data.completedAt))}
${row("Заказчик", "Отметил завершение в CargoCamp")}
${row("Исполнитель", "Отметил завершение в CargoCamp")}

<h2>6. Споры и замечания</h2>

${data.disputesCapturedAt
        ? row(
            "Состояние споров на дату",
            formatDate(data.disputesCapturedAt)
        )
        : ""}

${disputes.length === 0 ? `
    <p class="muted">
        ${data.disputesCapturedAt
        ? "На дату формирования акта зарегистрированных споров по заказу нет."
        : "В исходном экземпляре акта сведения о спорах не зафиксированы."}
    </p>
` : disputes.map((dispute) => `
    <div class="entry">
        <div class="entry-title">
            Спор №${escapeHtml(dispute.id)}
        </div>

        ${row("Дата открытия", formatDate(dispute.createdAt))}
        ${row(
        "Инициатор",
        dispute.openedByRole === "creator"
            ? "Заказчик"
            : "Исполнитель"
    )}
        ${row("Причина", dispute.reason)}
        ${row("Описание", dispute.description || "Не указано")}
        ${row("Статус", dispute.status)}
        ${row(
        "Результат рассмотрения",
        dispute.resolution || "Не зафиксирован"
    )}
        ${row("Дата решения", formatDate(dispute.resolvedAt))}
        ${row(
        "Прикреплённые доказательства",
        Array.isArray(dispute.evidence)
            ? dispute.evidence.length
            : 0
    )}

        ${(dispute.evidence || []).map((photo, index) => `
            <div class="hash">
                Доказательство ${index + 1} · SHA-256:
                ${escapeHtml(photo.sha256 || "—")}
            </div>
        `).join("")}
    </div>
`).join("")}

${data.remediation ? `
<h2>7. Исправление замечаний</h2>

${row(
        "Предыдущий акт",
        data.remediation.previousDocumentNumber
    )}
${row(
        "Первоначальные замечания",
        data.remediation.originalRemarks
    )}
${row(
        "Сообщение исполнителя",
        data.remediation.executorComment
    )}
${row(
        "Дата сообщения об исправлениях",
        formatDate(data.remediation.submittedAt)
    )}
${row(
        "Проверка заказчиком",
        formatDate(data.remediation.reviewedAt)
    )}
${row(
        "Комментарий заказчика",
        data.remediation.reviewComment || "Не указан"
    )}
` : ""}

<div class="warning">
    <strong>Порядок подтверждения.</strong>

    Отметка о завершении работ не равнозначна
    приёмке результата без замечаний.

    Приёмка фиксируется отдельно заказчиком,
    после чего акт может быть подписан сторонами
    в предусмотренном CargoCamp порядке.

    Подписи привязываются к конкретной версии
    и контрольной сумме PDF.
</div>

${renderPhotoAnnex(photoAnnex)}

<div class="footer">
    Документ сформирован системой CargoCamp.
    После сохранения PDF не изменяется.
    Контроль целостности выполняется по SHA-256.
</div>

</body>
</html>`;
}

async function generateVerifiedCompletionActPDF(
    data,
    photoAnnex = null
) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        });

        const page = await browser.newPage();

        await page.setContent(
            renderHtml(data, photoAnnex),
            { waitUntil: "load" }
        );

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "30px",
                right: "30px",
                bottom: "30px",
                left: "30px",
            },
        });

        return Buffer.from(pdf);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = generateVerifiedCompletionActPDF;
