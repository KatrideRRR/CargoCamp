const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests', // папка с тестами
    timeout: 30000, // таймаут для каждого теста
    use: {
        headless: true, // запуск в headless-режиме
        baseURL: 'http://localhost:3000', // или порт твоего dev-сервера
    },
    projects: [
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
