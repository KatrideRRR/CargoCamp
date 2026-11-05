const fs = require("node:fs");
const path = require("node:path");

/**
 * Загружает настоящий код backend-сервиса,
 * но заменяет его зависимости тестовыми.
 *
 * Ни MySQL, ни Socket.IO, ни настоящий
 * backend здесь не запускаются.
 */
function loadIsolatedService(filename, dependencies) {
    const fullPath = path.resolve(
        __dirname,
        "../../services",
        filename
    );

    const source = fs.readFileSync(
        fullPath,
        "utf8"
    );

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
                `Незапланированная зависимость: ${name}`
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
    loadIsolatedService,
};