const fs = require("fs");
const path = require("path");
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

function generateHTML(data) {

    return `

${escapeHtml(data.description)}
${escapeHtml(data.address)}
${escapeHtml(data.customerName)}
${escapeHtml(data.performerName)}
${escapeHtml(data.category)}
${escapeHtml(data.subcategory)}
${escapeHtml(data.paymentType)}

    <html lang="ru">
    <head>
      <meta charset="UTF-8" />
      <style>
        body {
          font-family: Arial, Helvetica, sans-serif;
          margin: 40px;
          line-height: 1.6;
          font-size: 14px;
          color: #111;
        }

        h1, h2 {
          text-align: center;
          margin-bottom: 18px;
        }

        .section {
          margin-top: 20px;
        }

        .section p {
          margin: 8px 0;
        }

        ul {
          margin: 10px 0 0 20px;
          padding: 0;
        }

        li {
          margin-bottom: 8px;
        }

        .signature-block {
          margin-top: 40px;
        }

        .auto-signature-note {
          font-style: italic;
          margin-top: 20px;
        }

        .second-page {
          page-break-before: always;
        }
      </style>
    </head>
    <body>
      <h1>ДОГОВОР №${data.orderId}</h1>

      <div class="section">
        <strong>Дата заключения:</strong> ${data.approvalDate}<br>
      </div>

      <div class="section">
        <p><strong>Заказчик:</strong> ${data.customerName} (ID: ${data.customerId})</p>
        <p><strong>Исполнитель:</strong> ${data.performerName} (ID: ${data.performerId})</p>
      </div>

      <div class="section">
        <p><strong>Стороны договорились о следующем:</strong></p>
        <ul>
          <li>Исполнитель обязуется выполнить работу по заказу в категории: <strong>${data.category || "—"}</strong>, подкатегории: <strong>${data.subcategory || "—"}</strong>.</li>
          <li>Адрес выполнения: <strong>${data.address || "—"}</strong>.</li>
          <li>Описание заказа: ${data.description || "—"}</li>

<li>
    Услуга:
    <strong>${escapeHtml(data.serviceName || "—")}</strong>
</li>

${Array.isArray(data.serviceDetailRows) &&
    data.serviceDetailRows.length > 0
        ? `
        <li>
            <strong>Дополнительные условия заказа:</strong>
            <ul>
                ${data.serviceDetailRows.map((item) => `
                    <li>
                        ${escapeHtml(item.label)}:
                        <strong>${escapeHtml(item.value)}</strong>
                    </li>
                `).join("")}
            </ul>
        </li>
    `
        : ""}

          <li>Стоимость работ: <strong>${data.price ?? 0} ₽</strong>.</li>
          <li>Форма оплаты: <strong>${data.paymentType || "—"}</strong>.</li>
          <li>Срок выполнения заказа до: <strong>${data.dueDate || "—"}</strong>.</li>
        </ul>
      </div>

      <div class="signature-block">
        <p class="auto-signature-note">
Настоящий документ сформирован автоматически
информационной системой CargoCamp на основании
сведений о заказе и действий его участников.

Факты направления исполнителем заявки и её
одобрения заказчиком фиксируются системой CargoCamp.

Сведения о применении сторонами электронной подписи
и подтверждении их личности устанавливаются отдельно.        </p>
      </div>

      ${
        data.completeAt && Array.isArray(data.completedBy) && data.completedBy.length === 2
            ? `
            <div class="second-page">
<h2>Информация о завершении заказа</h2>
              <p>
                Работы по заказу №${data.orderId} были выполнены в срок —
                <strong>${new Date(data.completeAt).toLocaleDateString("ru-RU")}</strong>.
              </p>
              <p>
Стороны отметили завершение заказа в информационной
системе CargoCamp.

Факт подтверждения завершения заказа сам по себе
не удостоверяет отсутствие претензий, получение
оплаты или подписание отдельного акта приёмки.
              </p>
            </div>
          `
            : ""
    }
      ${renderPhotoAnnex(data.photoAnnex)}
    </body>
    </html>
  `;
}

async function generateContractPDF(data, savePath) {
    let browser;

    try {
        const htmlContent = generateHTML(data);

        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process",
            ],
        });

        const page = await browser.newPage();

        await page.setContent(htmlContent, {
            waitUntil: "networkidle0",
        });

        await page.pdf({
            path: savePath,
            format: "A4",
            printBackground: true,
            margin: {
                top: "40px",
                bottom: "40px",
                left: "40px",
                right: "40px",
            },
        });

        return savePath;
    } catch (error) {
        console.error("❌ Ошибка генерации PDF договора:", error);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

module.exports = generateContractPDF;