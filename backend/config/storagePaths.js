const fs = require("fs");
const path = require("path");

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, {
        recursive: true,
    });

    return directoryPath;
}

const uploadsRoot = ensureDirectory(
    process.env.UPLOADS_DIR ||
    path.resolve(__dirname, "..", "uploads")
);

const contractsRoot = ensureDirectory(
    process.env.CONTRACTS_DIR ||
    path.resolve(__dirname, "..", "contracts")
);

const ordersRoot = ensureDirectory(
    path.join(uploadsRoot, "orders")
);

const tempRoot = ensureDirectory(
    path.join(uploadsRoot, "temp")
);

module.exports = {
    uploadsRoot,
    contractsRoot,
    ordersRoot,
    tempRoot,
    ensureDirectory,
};