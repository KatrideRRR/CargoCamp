
import React, { useState } from "react";

import axiosInstance
    from "../utils/axiosInstance";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "../utils/adminSession";

import "../styles/AdminContractEvidencePanel.css";

async function ensureSession() {
    if (!isAdminTokenValid(60000)) {
        await refreshAdminSession();
    }
}

function documentTitle(type) {
    if (type === "verified_assignment") {
        return "Договор-задание";
    }

    if (type === "verified_completion_act") {
        return "Акт завершения";
    }

    return "Документ";
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleString("ru-RU");
}

export default function AdminContractEvidencePanel() {
    const [orderId, setOrderId] = useState("");
    const [order, setOrder] = useState(null);
    const [documents, setDocuments] = useState([]);

    const [loading, setLoading] = useState(false);
    const [downloadingId, setDownloadingId] =
        useState(null);

    const [error, setError] = useState("");

    async function search(event) {
        event.preventDefault();

        if (!/^[1-9]\d*$/.test(orderId.trim())) {
            setError("Укажите ID заказа");
            return;
        }

        setLoading(true);
        setError("");
        setOrder(null);
        setDocuments([]);

        try {
            await ensureSession();

            const response =
                await axiosInstance.get(
                    `/admin/identity/orders/${orderId.trim()}/contracts`
                );

            setOrder(response.data.order);

            setDocuments(
                Array.isArray(response.data.documents)
                    ? response.data.documents
                    : []
            );

        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                "Не удалось найти документы заказа"
            );

        } finally {
            setLoading(false);
        }
    }

    async function downloadEvidence(contract) {
        if (downloadingId !== null) return;

        setDownloadingId(contract.id);
        setError("");

        let objectUrl = null;

        try {
            await ensureSession();

            const response =
                await axiosInstance.get(
                    `/admin/identity/contracts/${contract.id}/evidence`,
                    {
                        responseType: "blob",
                        adapter: "xhr",
                    }
                );

            const blob = new Blob(
                [response.data],
                { type: "application/json" }
            );

            objectUrl =
                URL.createObjectURL(blob);

            const link =
                document.createElement("a");

            link.href = objectUrl;

            link.download =
                `cargocamp-evidence-${contract.id}.json`;

            document.body.appendChild(link);
            link.click();
            link.remove();

        } catch (requestError) {
            let message =
                "Не удалось выгрузить доказательства";

            /*
             * При responseType=blob серверная
             * ошибка тоже приходит как Blob.
             */
            if (
                requestError.response?.data
                instanceof Blob
            ) {
                try {
                    const raw =
                        await requestError.response.data.text();

                    const parsed =
                        JSON.parse(raw);

                    message =
                        parsed.message || message;
                } catch {
                    // Оставляем безопасный текст ошибки.
                }
            }

            setError(message);

        } finally {
            if (objectUrl) {
                const urlToRevoke = objectUrl;

                setTimeout(() => {
                    URL.revokeObjectURL(urlToRevoke);
                }, 30000);
            }

            setDownloadingId(null);
        }
    }

    return (
        <section className="cc-contract-evidence">
            <div className="cc-contract-evidence-heading">
                <h2>
                    Доказательства по договорам
                </h2>

                <p>
                    Проверка документов и выгрузка
                    технического отчёта для администратора.
                </p>
            </div>

            <form
                className="cc-contract-evidence-search"
                onSubmit={search}
            >
                <input
                    type="text"
                    inputMode="numeric"
                    value={orderId}
                    onChange={(event) =>
                        setOrderId(event.target.value)
                    }
                    placeholder="Номер заказа"
                    aria-label="Номер заказа"
                />

                <button
                    type="submit"
                    disabled={loading}
                >
                    {loading
                        ? "Проверяем..."
                        : "Найти документы"}
                </button>
            </form>

            {error && (
                <p
                    className="cc-contract-evidence-error"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {order && (
                <div className="cc-contract-evidence-order">
                    <strong>
                        Заказ №{order.id}
                    </strong>

                    <span>
                        Заказчик: #{order.creatorId}
                        {" · "}
                        Исполнитель: #
                        {order.executorId || "—"}
                    </span>
                </div>
            )}

            {order && documents.length === 0 && (
                <p className="cc-contract-evidence-note">
                    Подтверждённых документов
                    у заказа пока нет.
                </p>
            )}

            {documents.map((contract) => (
                <article
                    key={contract.id}
                    className="cc-contract-evidence-card"
                >
                    <div>
                        <strong>
                            {documentTitle(contract.type)}
                            {" · "}
                            версия {contract.version}
                        </strong>

                        <p>
                            {contract.documentNumber}
                        </p>

                        <small>
                            Статус в БД: {contract.status}
                            {" · "}
                            {formatDate(contract.createdAt)}
                        </small>

                        <small>
                            SHA-256:{" "}
                            {contract.documentHash || "отсутствует"}
                        </small>
                    </div>

                    <button
                        type="button"
                        disabled={downloadingId !== null}
                        onClick={() =>
                            downloadEvidence(contract)
                        }
                    >
                        {downloadingId === contract.id
                            ? "Формируем..."
                            : "Скачать отчёт"}
                    </button>
                </article>
            ))}

            <p className="cc-contract-evidence-note">
                Выгрузка содержит служебные сведения
                и персональные данные участников.
                Передавать её следует только
                уполномоченным получателям.
            </p>
        </section>
    );
}
