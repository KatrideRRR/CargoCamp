const fs = require("node:fs");
const path = require("node:path");

const testsDir = path.resolve(
    __dirname,
    "../tests"
);

const files = fs.readdirSync(testsDir)
    .filter((name) => name.endsWith(".spec.js"))
    .sort();

const errors = [];

for (const file of files) {
    const fullPath = path.join(testsDir, file);

    const source = fs.readFileSync(
        fullPath,
        "utf8"
    );

    // Каждый тест должен использовать защиту сети.
    if (!source.includes("fixtures/safeTest")) {
        errors.push(
            `${file}: не подключён safeTest`
        );
    }

    // Не разрешаем прямой импорт Playwright.
    if (
        /(?:from\s*|require\(\s*)["']@playwright\/test["']/
            .test(source)
    ) {
        errors.push(
            `${file}: прямой импорт @playwright/test`
        );
    }

    // Никаких отключённых или эксклюзивных тестов.
    if (
        /\btest(?:\.describe)?\.(?:skip|only|fixme)\s*\(/
            .test(source)
    ) {
        errors.push(
            `${file}: обнаружен skip/only/fixme`
        );
    }

    // Прямой выход в сеть обходит остальные моки.
    if (
        /\broute\.continue\s*\(/
            .test(source)
    ) {
        errors.push(
            `${file}: обнаружен route.continue()`
        );
    }
}

console.log(
    `Проверено файлов Playwright: ${files.length}`
);

if (errors.length > 0) {
    console.error(
        "\nОбнаружены проблемы изоляции:\n"
    );

    for (const error of errors) {
        console.error(`- ${error}`);
    }

    process.exitCode = 1;
} else {
    console.log(
        "Проверка статических правил изоляции пройдена."
    );
}