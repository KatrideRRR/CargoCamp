
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = "2026-11-09";

const archivePath = path.join(
    __dirname,
    "..",
    "legal",
    `public_offer_${VERSION}.txt`
);

const text = fs.readFileSync(archivePath, "utf8");

const sha256 = crypto
    .createHash("sha256")
    .update(text, "utf8")
    .digest("hex");

const CURRENT_OFFER = Object.freeze({
    version: VERSION,
    sha256,
});

module.exports = { CURRENT_OFFER };
