const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

/**
 * Генерация HTML-договора
 */
function generateHTML(data) {
    return `
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
        <strong>Место заключения:</strong> ${data.city}
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
          <li>Стоимость работ: <strong>${data.price ?? 0} ₽</strong>.</li>
          <li>Форма оплаты: <strong>${data.paymentType || "—"}</strong>.</li>
          <li>Срок выполнения заказа до: <strong>${data.dueDate || "—"}</strong>.</li>
        </ul>
      </div>

      <div class="signature-block">
        <p class="auto-signature-note">
          Настоящий договор считается заключённым и подписанным обеими сторонами в электронной форме посредством действий в системе CargoCamp — отправки Исполнителем запроса на выполнение заказа и подтверждения его Заказчиком. Электронные действия сторон признаются юридически значимыми и эквивалентными собственноручной подписи.
        </p>
      </div>

      ${
        data.completeAt && Array.isArray(data.completedBy) && data.completedBy.length === 2
            ? `
            <div class="second-page">
              <h2>Акт выполнения работ</h2>
              <p>
                Работы по заказу №${data.orderId} были выполнены в срок —
                <strong>${new Date(data.completeAt).toLocaleDateString("ru-RU")}</strong>.
              </p>
              <p>
                Стороны подтверждают, что работы выполнены надлежащим образом, в полном объеме и в срок.
                Претензий друг к другу не имеют. Оплата произведена. Договор считается исполненным.
              </p>
              <p class="auto-signature-note">
                Настоящий акт подписан автоматически обеими сторонами через платформу CargoCamp.
              </p>
            </div>
          `
            : ""
    }
    </body>
    </html>
  `;
}

/**
 * Генерация PDF-договора
 */
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