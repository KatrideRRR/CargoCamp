
const puppeteer = require("puppeteer");

function escapeHtml(value) {
    return String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function money(kopecks) {
    return (Number(kopecks) / 100).toLocaleString(
        "ru-RU",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    ) + " ₽";
}

async function generateVerifiedAddendumPDF(data) {
    const row = (label, value) => `
        <div class="row">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(value)}</span>
        </div>
    `;

    const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: Arial, sans-serif;
        color: #172033;
        font-size: 12px;
        line-height: 1.55;
        padding: 16px;
    }
    h1 {
        font-size: 21px;
        margin-bottom: 5px;
    }
    h2 {
        font-size: 15px;
        margin-top: 25px;
    }
    .subtitle {
        color: #64748b;
        margin-bottom: 20px;
    }
    .parties {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        break-inside: avoid;
    }
    .party {
        padding: 14px;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        background: #f8fafc;
    }
    .party h3 {
        margin-top: 0;
    }
    .row {
        display: flex;
        gap: 16px;
        border-bottom: 1px solid #e2e8f0;
        padding: 9px 0;
        break-inside: avoid;
    }
    .row strong {
        flex: 0 0 175px;
    }
    .row span {
        flex: 1;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .work {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        padding: 14px;
        background: #f8fafc;
    }
    .price {
        padding: 16px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        border-radius: 10px;
        break-inside: avoid;
    }
    .note {
        margin-top: 24px;
        padding: 14px;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
    }
    .footer {
        margin-top: 25px;
        font-size: 10px;
        color: #64748b;
    }
</style>
</head>
<body>

<h1>ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ</h1>

<div class="subtitle">
    CargoCamp · Заказ №${escapeHtml(data.orderId)}
</div>

${row("Номер документа", data.documentNumber)}
${row("Основной договор", data.parentNumber)}
${row("SHA-256 основного договора", data.parentHash)}
${row("Дата формирования", data.generatedAt)}

<h2>1. Участники соглашения</h2>

<div class="parties">
    <div class="party">
        <h3>Заказчик</h3>
        <strong>${escapeHtml(data.customerName)}</strong>
        <p>ID: ${escapeHtml(data.creatorId)}</p>
    </div>
    <div class="party">
        <h3>Исполнитель</h3>
        <strong>${escapeHtml(data.executorName)}</strong>
        <p>ID: ${escapeHtml(data.executorId)}</p>
    </div>
</div>

<h2>2. Дополнительные работы</h2>

<div class="work">${escapeHtml(data.additionalWork)}</div>

<h2>3. Изменение стоимости</h2>

<div class="price">
    ${row("Стоимость до изменения", money(data.basePriceKopecks))}
    ${row(
        "Изменение",
        (data.proposedPriceKopecks >= data.basePriceKopecks ? "+" : "") +
        money(data.proposedPriceKopecks - data.basePriceKopecks)
    )}
    ${row("Новая общая стоимость", money(data.proposedPriceKopecks))}
</div>

<h2>4. Порядок вступления в силу</h2>

<div class="note">
    Стороны согласовали перечень дополнительных работ
    и изменение общей стоимости заказа.

    Настоящий экземпляр является проектом документа
    до получения подтверждений обеих сторон
    в предусмотренном CargoCamp порядке электронной подписи.

    Остальные условия основного договора сохраняются,
    если они прямо не изменены настоящим соглашением.

    Сведения о подписях хранятся отдельно и привязываются
    к контрольной сумме SHA-256 настоящего PDF.
</div>

<div class="footer">
    CargoCamp · Неизменяемый электронный документ.
    Контроль целостности: SHA-256.
</div>

</body>
</html>`;

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

        await page.setContent(html, {
            waitUntil: "load",
        });

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

module.exports = generateVerifiedAddendumPDF;
