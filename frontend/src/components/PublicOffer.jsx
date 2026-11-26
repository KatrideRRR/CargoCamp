import React from "react";

import offerDocument from "./PublicOfferDocument.json";

export const PUBLIC_OFFER_VERSION =
    offerDocument.version;

export const PUBLIC_OFFER_SHA256 =
    offerDocument.sha256;

export const PUBLIC_OFFER_EFFECTIVE_DATE =
    offerDocument.effectiveDate.replace(
        /^Дата начала действия:\s*/,
        ""
    );

export default function PublicOffer() {
    return (
        <div
            className="cc-public-offer"
            data-offer-version={
                PUBLIC_OFFER_VERSION
            }
            data-offer-sha256={
                PUBLIC_OFFER_SHA256
            }
        >
            <p className="cc-offer-version">
                <strong>
                    {offerDocument.title}
                </strong>

                {" — "}

                {offerDocument.edition}

                {". "}

                {offerDocument.effectiveDate}

                {"."}
            </p>

            {offerDocument.sections.map(
                (section) => (
                    <section
                        key={section.title}
                    >
                        <h4>
                            {section.title}
                        </h4>

                        {section.paragraphs.map(
                            (paragraph, index) => (
                                <p key={index}>
                                    {paragraph}
                                </p>
                            )
                        )}
                    </section>
                )
            )}
        </div>
    );
}