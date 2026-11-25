"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    CURRENT_OFFER,
} = require(
    "../services/publicOfferConsentService"
);

const root = path.resolve(
    __dirname,
    "../.."
);

const document = require(
    "../../frontend/src/components/PublicOfferDocument.json"
);

test(
    "frontend и backend используют одинаковую версию оферты",
    () => {
        assert.equal(
            document.version,
            CURRENT_OFFER.version
        );

        assert.equal(
            document.sha256,
            CURRENT_OFFER.sha256
        );
    }
);

test(
    "хеш frontend-документа совпадает с архивом",
    () => {
        const archivePath = path.join(
            root,
            "backend",
            "legal",
            `public_offer_${document.version}.txt`
        );

        const source = fs.readFileSync(
            archivePath,
            "utf8"
        );

        const hash = crypto
            .createHash("sha256")
            .update(source, "utf8")
            .digest("hex");

        assert.equal(
            document.sha256,
            hash
        );
    }
);

test(
    "отображаемый текст соответствует архивной редакции",
    () => {
        const archivePath = path.join(
            root,
            "backend",
            "legal",
            `public_offer_${document.version}.txt`
        );

        const source = fs.readFileSync(
            archivePath,
            "utf8"
        );

        const normalize = (value) =>
            value.replace(/\s+/g, " ").trim();

        const displayed = [
            document.title,
            document.edition,
            document.effectiveDate,

            ...document.sections.flatMap(
                (section) => [
                    section.title,
                    ...section.paragraphs,
                ]
            ),
        ].join("\n");

        assert.equal(
            normalize(displayed),
            normalize(source)
        );
    }
);