import React, {useState,} from "react";
import {downloadVerifiedContract,} from "../utils/downloadVerifiedContract";
import "../styles/VerifiedAssignmentCard.css";
import SignatureAgreementPanel from "./SignatureAgreementPanel";

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}


function getDocumentStatus(contract) {
    const signed =
        Boolean(contract.fullySignedAt) &&
        [
            "signed",
            "fully_signed",
        ].includes(contract.status);

    if (signed) {
        return {
            label: "Подписан",
            className: "signed",
            description:
                "Документ подписан обеими сторонами.",
        };
    }

    if (contract.status === "draft") {
        return {
            label: "Проект",
            className: "draft",
            description:
                "Личность обеих сторон была подтверждена " +
                "при формировании проекта. " +
                "Электронные подписи ещё не получены.",
        };
    }

    return {
        label: "В обработке",
        className: "pending",
        description:
            "Проверьте текущий статус документа " +
            "перед его подписанием.",
    };
}


export default function VerifiedAssignmentCard({
                                                   assignment,
                                               }) {
    const [downloading, setDownloading] =
        useState(false);

    const [error, setError] =
        useState("");

    if (!assignment) {
        return null;
    }

    const status =
        getDocumentStatus(assignment);

    const handleDownload = async (event) => {
        event.stopPropagation();

        if (downloading) return;

        try {
            setDownloading(true);
            setError("");

            await downloadVerifiedContract(
                assignment.id,
                assignment.version
            );

        } catch (downloadError) {
            setError(
                downloadError.message ||
                "Не удалось скачать документ"
            );

        } finally {
            setDownloading(false);
        }
    };

    return (
        <section
            className="cc-verified-assignment"
            aria-label="Документ подтверждённой сделки"
            onClick={(event) => {
                event.stopPropagation();
            }}
        >
            <div className="cc-va-header">
                <div className="cc-va-header-main">
                    <span
                        className="cc-va-icon"
                        aria-hidden="true"
                    >
                        🛡️
                    </span>

                    <div className="cc-va-heading">
                        <strong>
                            Документ подтверждённой сделки
                        </strong>

                        <small>
                            Договор-задание CargoCamp
                        </small>
                    </div>
                </div>

                <span
                    className={
                        `cc-va-status ${status.className}`
                    }
                >
                    {status.label}
                </span>
            </div>

            <div className="cc-va-document">
                <strong>
                    {assignment.documentNumber ||
                        `Договор №${assignment.id}`}
                </strong>

                <p>
                    {status.description}
                </p>
            </div>

            <div className="cc-va-details">
                <div>
                    <span>Версия документа</span>
                    <strong>
                        {assignment.version}
                    </strong>
                </div>

                <div>
                    <span>Сформирован</span>
                    <strong>
                        {formatDate(
                            assignment.createdAt
                        )}
                    </strong>
                </div>

                <div>
                    <span>Подписание</span>
                    <strong>
                        {status.className === "signed"
                            ? formatDate(
                                assignment.fullySignedAt
                            )
                            : "Не завершено"}
                    </strong>
                </div>
            </div>

            {error && (
                <div
                    className="cc-va-error"
                    role="alert"
                >
                    {error}
                </div>
            )}

            <button
                type="button"
                className="cc-va-download"
                disabled={downloading}
                onClick={handleDownload}
            >
                <span aria-hidden="true">
                    📄
                </span>

                {downloading
                    ? "Скачиваем..."
                    : "Скачать проект договора (PDF)"}
            </button>

            {assignment.status === "draft" && (
                <SignatureAgreementPanel />
            )}

            <div className="cc-va-footnote">
                Документ хранится отдельно от обычного
                договора заказа. Целостность PDF
                проверяется системой CargoCamp.
            </div>
        </section>
    );
}
