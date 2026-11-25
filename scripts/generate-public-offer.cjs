"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");

const { CURRENT_OFFER } = require(
    "../backend/services/publicOfferConsentService"
);

const version = CURRENT_OFFER.version;

const source = path.join(
    root,
    "backend",
    "legal",
    `public_offer_${version}.txt`
);

const target = path.join(
    root,
    "frontend",
    "src",
    "components",
    "PublicOfferDocument.json"
);

const raw = fs.readFileSync(
    source,
    "utf8"
);

const sha256 = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");

const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n");

const document = {
    version,
    sha256,
    title: lines[0],
    edition: lines[1],
    effectiveDate: lines[2],
    sections: [],
};

let section = null;
let paragraph = [];

function flushParagraph() {
    if (
        section &&
        paragraph.length > 0
    ) {
        section.paragraphs.push(
            paragraph.join(" ")
        );
    }

    paragraph = [];
}

for (const rawLine of lines.slice(3)) {
    const line = rawLine.trim();

    if (/^\d+\.\s+/.test(line)) {
        flushParagraph();

        section = {
            title: line,
            paragraphs: [],
        };

        document.sections.push(
            section
        );

        continue;
    }

    if (!line) {
        flushParagraph();
        continue;
    }

    paragraph.push(line);
}

flushParagraph();

if (!document.sections.length) {
    throw new Error(
        "В документе отсутствуют разделы"
    );
}

if (
    document.sha256 !==
    CURRENT_OFFER.sha256
) {
    throw new Error(
        "SHA-256 документа не совпадает"
    );
}

fs.writeFileSync(
    target,
    JSON.stringify(
        document,
        null,
        2
    ) + "\n",
    "utf8"
);

console.log(
    "Версия:",
    version
);

console.log(
    "SHA-256:",
    sha256
);

console.log(
    "Разделов:",
    document.sections.length
);

console.log(
    "Документ сформирован:",
    target
);