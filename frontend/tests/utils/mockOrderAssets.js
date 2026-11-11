/*
 * Изолированные ресурсы для тестов заказов.
 *
 * Никаких обращений к реальным:
 * - Яндекс.Картам;
 * - серверам фотографий;
 * - backend CargoCamp.
 */

const FAKE_API_ORIGIN =
    "http://127.0.0.1:59999";

// Настоящий PNG размером 1×1 пиксель.
const MOCK_IMAGE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
);

const MOCK_PHOTO_PATHS = [
    "/uploads/orders/101/photo1.jpg",
    "/uploads/orders/101/photo2.jpg",

    "/uploads/express/201/photo1.jpg",
    "/uploads/express/201/photo2.jpg",

    "/uploads/orders/1/photo1.jpg",
    "/uploads/orders/1/photo2.jpg",
];

export async function mockOrderAssets(page) {

    /*
 * Google Fonts используется на страницах
 * авторизации и отзывов.
 *
 * В E2E-тестах внешние стили не загружаем.
 */
    await page.route(
        "https://fonts.googleapis.com/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/css",
                body: "",
            });
        }
    );

    /*
     * Карты не загружаем из интернета.
     *
     * Для тестов списка заказов и бронирования
     * достаточно эмулировать загрузку скрипта.
     *
     * Интерактивную карту будем тестировать
     * отдельно с полноценным мок-объектом.
     */
    await page.route(
        "https://api-maps.yandex.ru/2.1/**",
        async (route) => {
            if (
                route.request().method() !== "GET"
            ) {
                await route.fallback();
                return;
            }

            await route.fulfill({
                status: 200,
                contentType:
                    "application/javascript",
                body: "",
            });
        }
    );

    /*
     * Подменяем только фотографии,
     * присутствующие в наших тестовых данных.
     *
     * Любые неизвестные URL продолжит
     * блокировать safeTest.js.
     */
    for (const path of MOCK_PHOTO_PATHS) {
        await page.route(
            `${FAKE_API_ORIGIN}${path}`,
            async (route) => {
                if (
                    route.request().method() !== "GET"
                ) {
                    await route.fallback();
                    return;
                }

                await route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: MOCK_IMAGE,
                });
            }
        );
    }
}