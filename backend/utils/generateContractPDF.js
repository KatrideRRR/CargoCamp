const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

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
          font-family: Arial, sans-serif;
          margin: 40px;
          line-height: 1.6;
          font-size: 14px;
        }
        h1, h2 {
          text-align: center;
        }
        .section {
          margin-top: 20px;
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
        <p>Стороны договорились о следующем:</p>
        <ul>
          <li>Исполнитель обязуется выполнить работу по заказу в категории: <strong>${data.category}</strong>, подкатегории: <strong>${data.subcategory}</strong>.</li>
          <li>Адрес выполнения: <strong>${data.address}</strong>.</li>
          <li>Описание заказа: ${data.description}</li>
          <li>Стоимость работ: <strong>${data.price} ₽</strong>.</li>
          <li>Форма оплаты: <strong>${data.paymentType}</strong>.</li>
          <li>Срок выполнения заказа до: <strong>${data.dueDate}</strong>.</li>
        </ul>
      </div>

      <div class="signature-block">
        <p class="auto-signature-note">
          Настоящий договор считается заключённым и подписанным обеими сторонами в электронной форме посредством действий в системе CargoCamp — отправки Исполнителем запроса на выполнение заказа и подтверждения его Заказчиком. Электронные действия сторон признаются юридически значимыми и эквивалентными собственноручной подписи.
        </p>
      </div>

      ${
        data.completeAt && data.completedBy.length === 2
            ? `<div class="second-page">
              <h2>Акт выполнения работ</h2>
              <p>Работы по заказу №${data.orderId} были выполнены в срок — <strong>${new Date(data.completeAt).toLocaleDateString('ru-RU')}</strong>.</p>
              <p>Стороны подтверждают, что работы выполнены надлежащим образом, в полном объеме и в срок. Претензий друг к другу не имеют. Оплата произведена. Договор считается исполненным.</p>
              <p class="auto-signature-note">
                Настоящий акт подписан автоматически обеими сторонами через платформу CargoCamp.
              </p>
            </div>`
            : ''
    }

    </body>
    </html>
  `;
}


/**
 * Генерация PDF-договора
 */
async function generateContractPDF(data, savePath) {
    const htmlContent = generateHTML(data);

    const browser = await puppeteer.launch({
        headless: 'new', // для puppeteer v20+
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: savePath,
        format: 'A4',
        printBackground: true,
        margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
    });

    await browser.close();
}

module.exports = generateContractPDF;
