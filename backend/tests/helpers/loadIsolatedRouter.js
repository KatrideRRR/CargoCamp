const fs = require("node:fs");
const path = require("node:path");

function loadIsolatedRouter(filename, dependencies) {
    if (!/^[a-zA-Z0-9_-]+\.js$/.test(filename)) {
        throw new Error("Недопустимое имя маршрута");
    }

    const fullPath = path.resolve(
        __dirname,
        "../../routes",
        filename
    );

    const source = fs.readFileSync(fullPath, "utf8");

    const isolatedModule = {
        exports: {},
    };

    const isolatedRequire = (name) => {
        if (
            !Object.prototype.hasOwnProperty.call(
                dependencies,
                name
            )
        ) {
            throw new Error(
                `ЗАПРЕЩЁН незамокированный импорт: ${name}`
            );
        }

        return dependencies[name];
    };

    const factory = new Function(
        "require",
        "module",
        "exports",
        "__filename",
        "__dirname",
        source
    );

    factory(
        isolatedRequire,
        isolatedModule,
        isolatedModule.exports,
        fullPath,
        path.dirname(fullPath)
    );

    return isolatedModule.exports;
}

module.exports = {
    loadIsolatedRouter,
};