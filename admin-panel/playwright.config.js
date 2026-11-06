const { defineConfig, devices } = require("@playwright/test");

const FRONT_URL = "http://localhost:3001";
const FAKE_API_URL = "http://127.0.0.1:59998";

module.exports = defineConfig({
    testDir: "./tests",
    timeout: 30000,

    expect: {
        timeout: 10000,
    },

    use: {
        baseURL: FRONT_URL,
        headless: true,
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },

    webServer: {
        command: "npm start",
        cwd: __dirname,
        url: FRONT_URL,
        timeout: 180000,
        reuseExistingServer: false,

        env: {
            PORT: "3001",
            BROWSER: "none",
            REACT_APP_API_URL: FAKE_API_URL,
            REACT_APP_SOCKET_URL: FAKE_API_URL,
            REACT_APP_YANDEX_API_KEY: "playwright-test-only-key",

        },
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
        },
        {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
        },
    ],
});