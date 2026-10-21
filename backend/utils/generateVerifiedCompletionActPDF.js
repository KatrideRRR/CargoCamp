
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
    if (!value) return "Не указано";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Не указано";
    }

    return date.toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function renderHtml(data) {
    const row = (label, value) => `
        <div class="row">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(value)}</span>
        </div>
    `;

    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: Arial, sans-serif;
        color: #172033;
        font-size: 12px;
        line-height: 1.6;
        padding: 14px;
    }

    h1 {
        margin-bottom: 5px;
        font-size: 21px;
        color: #0f172a;
    }

    h2 {
        margin-top: 25px;
        font-size: 15px;
    }

    .subtitle {
        color: #64748b;
        margin-bottom: 22px;
    }

    .notice {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        padding: 13px;
        border-radius: 9px;
    }

    .row {
        display: flex;
        gap: 15px;
        padding: 9px 0;
        border-bottom: 1px solid #e2e8f0;
    }

    .row strong {
        flex: 0 0 175px;
    }

    .row span {
        flex: 1;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .warning {
        margin-top: 23px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 10px;
        padding: 15px;
    }

    .footer {
        margin-top: 25px;
        color: #64748b;
        font-size: 10px;
    }
</style>
</head>
<body>

<h1>АКТ О ЗАВЕРШЕНИИ ЗАКАЗА</h1>

<div class="subtitle">
    CargoCamp · Проект документа · Версия ${escapeHtml(data.version)}
</div>

<div class="notice">
    ПРОЕКТ АКТА. НЕ ПОДПИСАН СТОРОНАМИ.
    Не является автоматическим подтверждением
    качества, оплаты или отсутствия претензий.
</div>

<h2>1. Сведения о документе</h2>

${row("Номер акта", data.documentNumber)}
${row("Заказ №", data.orderId)}
${row("Договор-задание", data.assignmentNumber)}
${row("Дата формирования", formatDate(data.generatedAt))}

<h2>2. Участники</h2>

${row("Заказчик", data.customerName)}
${row("ID заказчика", data.customerId)}
${row("Исполнитель", data.executorName)}
${row("ID исполнителя", data.executorId)}

<h2>3. Сведения о заказе</h2>

${row("Категория", data.category)}
${row("Подкатегория", data.subcategory)}
${row("Адрес", data.address)}
${row("Описание", data.description)}
${row("Согласованная стоимость", data.priceRub + " ₽")}
${row("Способ оплаты", data.paymentType)}

<h2>4. Отметки о завершении</h2>

${row("Начало работы", formatDate(data.workStartedAt))}
${row("Окончание работы", formatDate(data.workEndedAt))}
${row("Завершение заказа", formatDate(data.completedAt))}
${row("Отметка заказчика", "Завершение подтверждено в приложении")}
${row("Отметка исполнителя", "Завершение подтверждено в приложении")}

<div class="warning">
    <strong>Важное пояснение.</strong>

    Отметки о завершении заказа отражают действия
    пользователей в CargoCamp.

    Они сами по себе не удостоверяют надлежащее
    качество работ, отсутствие недостатков,
    отсутствие претензий или получение оплаты.

    Настоящий документ является проектом акта.
    Его отдельное электронное подписание сторонами
    и фиксация возражений предусмотрены
    самостоятельной процедурой.
</div>

<div class="footer">
    Сформировано системой CargoCamp.
    После сохранения PDF не изменяется.
    Контроль целостности: SHA-256.
</div>

</body>
</html>`;
}

async function generateVerifiedCompletionActPDF(data) {
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
            renderHtml(data),
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
