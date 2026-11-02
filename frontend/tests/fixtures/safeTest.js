const {
    test: base,
    expect,
} = require("@playwright/test");

const FRONT_ORIGIN = "http://localhost:3000";

const test = base.extend({
    networkFence: [
        async ({ context }, use, testInfo) => {
            const unexpectedRequests = [];

            /*
             * Запрещаем обращения к любым
             * внешним адресам.
             *
             * Разрешаем только frontend.
             *
             * Специальные моки page.route()
             * имеют приоритет над этим
             * обработчиком.
             */
            await context.route("**/*", async (route) => {
                const request = route.request();

                let url;

                try {
                    url = new URL(request.url());
                } catch {
                    unexpectedRequests.push(request.url());

                    await route.abort("blockedbyclient");
                    return;
                }

                if (url.origin === FRONT_ORIGIN) {
                    await route.continue();
                    return;
                }

                unexpectedRequests.push(
                    `${request.method()} ${url.href}`
                );

                await route.abort("blockedbyclient");
            });

            await use();

            /*
             * Тест не должен считаться успешным,
             * если приложение попыталось
             * обратиться к незамокированному API
             * или внешнему сервису.
             */
            expect(
                unexpectedRequests,
                `В тесте "${testInfo.title}" обнаружены ` +
                "незамокированные сетевые запросы"
            ).toEqual([]);
        },

        { auto: true },
    ],
});

module.exports = {
    test,
    expect,
};