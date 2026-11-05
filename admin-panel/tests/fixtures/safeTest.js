const {
    test: base,
    expect,
} = require("@playwright/test");

const FRONT_ORIGIN = "http://localhost:3001";

const test = base.extend({
    networkFence: [
        async ({ context }, use, testInfo) => {
            const unexpectedRequests = [];

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

            expect(
                unexpectedRequests,
                `Незамокированные запросы в тесте: ${testInfo.title}`
            ).toEqual([]);
        },

        { auto: true },
    ],
});

module.exports = {
    test,
    expect,
};