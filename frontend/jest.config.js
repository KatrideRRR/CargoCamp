module.exports = {
    rootDir: __dirname,

    roots: [
        "<rootDir>/src",
        "<rootDir>/tests/unit",
    ],

    testEnvironment: "jsdom",

    testMatch: [
        "<rootDir>/tests/unit/**/*.test.js",
        "<rootDir>/tests/unit/**/*.test.jsx",
    ],

    setupFilesAfterEnv: [
        "<rootDir>/tests/unit/setup.js",
    ],

    transform: {
        "^.+\\.[jt]sx?$": "babel-jest",
    },

    moduleNameMapper: {
        "^axios$":
            "axios/dist/node/axios.cjs",

        "^lucide-react$":
            "<rootDir>/node_modules/lucide-react/dist/cjs/lucide-react.js",

        "\\.(css|scss|sass|less)$":
            "<rootDir>/tests/unit/styleMock.js",
    },

    clearMocks: true,
};