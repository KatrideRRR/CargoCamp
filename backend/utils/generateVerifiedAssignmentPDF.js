
const puppeteer = require("puppeteer");

function escapeHtml(value) {
    return String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDate(value) {
    if (!value) return "Не указана";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "Не указана"
        : date.toLocaleString("ru-RU", {
            timeZone: "Europe/Moscow",
        });
}

function renderHtml(snapshot) {
    const terms = snapshot.terms;
    const customer = snapshot.customer;
    const executor = snapshot.executor;

    const priceRub = (
        Number(terms.priceKopecks) / 100
    ).toFixed(2);

    const row = (label, value) => `
        <div class="row">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(value)}</span>
        </div>
    `;

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: Arial, sans-serif;
        padding: 16px;
        color: #172033;
        font-size: 12px;
        line-height: 1.55;
    }

    h1 {
        font-size: 21px;
        margin-bottom: 6px;
    }

    h2 {
        font-size: 15px;
        margin-top: 26px;
    }

    .subtitle {
        color: #64748b;
        margin-bottom: 24px;
    }

    .status {
        padding: 12px;
        margin-bottom: 20px;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        background: #eff6ff;
        font-weight: bold;
    }

    .row {
        display: flex;
        gap: 16px;
        margin: 8px 0;
        padding-bottom: 8px;
        border-bottom: 1px solid #e2e8f0;
    }

    .row strong {
        width: 180px;
        flex-shrink: 0;
    }

    .row span {
        flex: 1;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .notice {
        margin-top: 28px;
        padding: 15px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
    }

    .footer {
        margin-top: 35px;
        color: #64748b;
        font-size: 10px;
    }
</style>
</head>
<body>

<h1>ДОГОВОР-ЗАДАНИЕ</h1>

<div class="subtitle">
    CargoCamp · Заказ №${escapeHtml(terms.orderId)}
    · Версия ${escapeHtml(snapshot.version)}
</div>

<div class="status">
    ЭЛЕКТРОННЫЙ ДОКУМЕНТ CARGOCAMP
</div>

${row("Номер документа", snapshot.documentNumber)}
${row("Сформирован", formatDate(snapshot.generatedAt))}

<h2>1. Участники</h2>

${row("Заказчик, ID", customer.userId)}
${row("Имя в профиле", customer.profileName)}
${row("Проверка личности", "Подтверждена на момент формирования")}
${row("Исполнитель, ID", executor.userId)}
${row("Имя в профиле", executor.profileName)}
${row("Проверка личности", "Подтверждена на момент формирования")}

<h2>2. Задание</h2>

${row("Категория", terms.category)}
${row("Подкатегория", terms.subcategory)}
${row("Адрес", terms.address)}
${row("Описание", terms.description)}
${row("Запланированное время", formatDate(terms.workTime))}
${row("Стоимость работ", priceRub + " ₽")}
${row("Способ оплаты", terms.paymentType)}

<h2>3. Статус документа</h2>

<div class="notice">
    Документ сформирован информационной системой
    CargoCamp по сведениям заказа.

    На момент формирования этого экземпляра
    электронные подписи отсутствовали.

    Дальнейшие подтверждения сторон фиксируются
    отдельно в журнале электронных подписей,
    привязанном к SHA-256 данного PDF.

    Содержание сформированного PDF при подписании
    не изменяется. Актуальный статус подписей
    определяется по записям CargoCamp.
</div>

<div class="footer">
    Документ CargoCamp.
    Версия неизменяема после сохранения.
    Контроль целостности выполняется по SHA-256.
</div>

</body>
</html>`;
}

async function generateVerifiedAssignmentPDF(snapshot) {
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
            renderHtml(snapshot),
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

module.exports = generateVerifiedAssignmentPDF;
