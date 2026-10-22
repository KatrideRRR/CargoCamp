import React, {useState} from "react";
import {downloadVerifiedContract,} from "../utils/downloadVerifiedContract";
import "../styles/VerifiedAssignmentCard.css";
import ActAcceptancePanel from "./ActAcceptancePanel";

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleString("ru-RU");
}

export default function VerifiedCompletionActCard({
                                                      act,
                                                  }) {
    const [downloading, setDownloading] =
        useState(false);

    const [error, setError] = useState("");

    if (!act) return null;

    const signed =
        act.status === "fully_signed" &&
        Boolean(act.fullySignedAt);

    const handleDownload = async (event) => {
        event.stopPropagation();

        if (downloading) return;

        try {
            setDownloading(true);
            setError("");

            await downloadVerifiedContract(
                act.id,
                act.version,
                "act"
            );

        } catch (downloadError) {
            setError(
                downloadError.message ||
                "Не удалось скачать акт"
            );

        } finally {
            setDownloading(false);
        }
    };

    return (
        <section
            className="cc-verified-assignment cc-completion-act"
            aria-label="Акт завершения заказа"
            onClick={(event) =>
                event.stopPropagation()
            }
        >
            <div className="cc-va-header">
                <div className="cc-va-header-main">
                    <span
                        className="cc-va-icon"
                        aria-hidden="true"
                    >
                        📋
                    </span>

                    <div className="cc-va-heading">
                        <strong>
                            Акт завершения заказа
                        </strong>

                        <small>
                            Отдельный документ CargoCamp
                        </small>
                    </div>
                </div>

                <span
                    className={`cc-va-status ${
                        signed ? "signed" : "draft"
                    }`}
                >
                    {signed ? "Подписан" : "Проект"}
                </span>
            </div>

            <div className="cc-va-document">
                <strong>
                    {act.documentNumber}
                </strong>

                <p>
                    Заказ отмечен завершённым обеими
                    сторонами. Проект акта не является
                    подтверждением отсутствия претензий
                    или факта оплаты.
                </p>
            </div>

            <div className="cc-va-details">
                <div>
                    <span>Версия</span>
                    <strong>{act.version}</strong>
                </div>

                <div>
                    <span>Сформирован</span>
                    <strong>
                        {formatDate(act.createdAt)}
                    </strong>
                </div>

                <div>
                    <span>Статус</span>
                    <strong>
                        {signed
                            ? "Подписан"
                            : "Ожидает оформления"}
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
                📄{" "}
                {downloading
                    ? "Скачиваем..."
                    : "Скачать акт (PDF)"}
            </button>

            <ActAcceptancePanel act={act} />

            <p className="cc-va-footnote">
                Решение о приёмке фиксируется отдельно
                от подписания акта. PDF остаётся
                неизменным. Электронное подписание
                акта пока недоступно.
            </p>
        </section>
    );
}
