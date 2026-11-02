const { defineConfig, devices } = require("@playwright/test");

const FRONT_URL = "http://localhost:3000";

// Специальный локальный адрес без backend.
// Любые незамокированные запросы будут блокироваться.
const FAKE_API_URL = "http://127.0.0.1:59999";

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
            PORT: "3000",
            BROWSER: "none",

            REACT_APP_API_URL: FAKE_API_URL,

            REACT_APP_SOCKET_URL: FAKE_API_URL,
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