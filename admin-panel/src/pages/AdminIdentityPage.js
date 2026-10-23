import React, {
    useCallback,
    useEffect,
    useState,
} from "react";

import { Link } from "react-router-dom";

import axiosInstance from "../utils/axiosInstance";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "../utils/adminSession";

import "../styles/AdminIdentityPage.css";
import VerifiedIdentityManagement
    from "../components/VerifiedIdentityManagement";

const DOCUMENT_TYPES = {
    passport_page: "Документ, удостоверяющий личность",
    other_identity_document: "Другой документ",
};


function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleString("ru-RU");
}


function formatSize(bytes) {
    if (!Number.isFinite(Number(bytes))) {
        return "—";
    }

    return `${(Number(bytes) / 1024).toFixed(1)} КБ`;
}


function formatInputDate(date) {
    const year = date.getFullYear();

    const month = String(
        date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function getDefaultExpiryDate() {
    const date = new Date();

    date.setFullYear(
        date.getFullYear() + 1
    );

    return formatInputDate(date);
}


function getErrorMessage(error) {
    return (
        error?.response?.data?.message &&
        typeof error.response.data.message === "string"
            ? error.response.data.message
            : "Не удалось выполнить запрос"
    );
}


async function ensureAdminSession() {
    if (!isAdminTokenValid(60 * 1000)) {
        await refreshAdminSession();
    }
}


function AdminIdentityPage() {
    const [applications, setApplications] =
        useState([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [success, setSuccess] =
        useState("");

    const [selectedId, setSelectedId] =
        useState(null);

    const [validUntil, setValidUntil] =
        useState(getDefaultExpiryDate);

    const [reason, setReason] =
        useState("");

    const [documentsChecked, setDocumentsChecked] =
        useState(false);

    const [saving, setSaving] =
        useState(false);

    const [downloadingId, setDownloadingId] =
        useState(null);


    /*
     * Загрузка очереди заявок.
     *
     * API возвращает до 50 ожидающих заявок.
     */
    const loadApplications = useCallback(async () => {
        try {
            setLoading(true);
            setError("");

            await ensureAdminSession();

            const response = await axiosInstance.get(
                "/admin/identity/pending"
            );

            const list =
                response.data?.applications;

            setApplications(
                Array.isArray(list)
                    ? list
                    : []
            );

        } catch (err) {
            setError(
                getErrorMessage(err)
            );

        } finally {
            setLoading(false);
        }
    }, []);


    useEffect(() => {
        loadApplications();
    }, [loadApplications]);


    /*
     * Выбранная заявка.
     */
    const selectedApplication =
        applications.find(
            (application) =>
                String(application.id) ===
                String(selectedId)
        ) || null;


    /*
     * Открываем или закрываем заявку.
     */
    const selectApplication = (application) => {
        if (
            String(selectedId) ===
            String(application.id)
        ) {
            setSelectedId(null);
            return;
        }

        setSelectedId(application.id);

        setReason("");

        setValidUntil(
            getDefaultExpiryDate()
        );

        setDocumentsChecked(false);

        setError("");
        setSuccess("");
    };


    /*
     * Скачивание документов.
     *
     * Запрос выполняется с JWT администратора.
     *
     * Сервер:
     * - проверяет сессию;
     * - проверяет принадлежность документа;
     * - расшифровывает файл;
     * - проверяет SHA-256;
     * - записывает событие аудита.
     */
    const downloadDocument = async (
        application,
        file
    ) => {
        let objectUrl = null;

        try {
            setDownloadingId(file.id);
            setError("");

            await ensureAdminSession();

            const response = await axiosInstance.get(
                `/admin/identity/${application.id}/document/${file.id}`,
                {
                    responseType: "blob",
                }
            );

            const mimeType =
                String(file.mimeType || "");

            const extension =
                mimeType === "application/pdf"
                    ? "pdf"
                    : mimeType === "image/png"
                        ? "png"
                        : "jpg";

            const blob = new Blob(
                [response.data],
                {
                    type:
                        mimeType ||
                        "application/octet-stream",
                }
            );

            objectUrl =
                URL.createObjectURL(blob);

            const link =
                window.document.createElement("a");

            link.href = objectUrl;

            link.download =
                `identity-${application.id}-document-${file.id}.${extension}`;

            window.document.body.appendChild(
                link
            );

            link.click();
            link.remove();

        } catch (err) {
            setError(
                "Не удалось получить документ. " +
                getErrorMessage(err)
            );

        } finally {
            if (objectUrl) {
                const urlToRevoke = objectUrl;

                window.setTimeout(() => {
                    URL.revokeObjectURL(
                        urlToRevoke
                    );
                }, 1000);
            }

            setDownloadingId(null);
        }
    };


    /*
     * Подтверждение или отклонение личности.
     *
     * Backend принимает:
     *
     * action: approve | reject
     * reason: string
     * validUntil: YYYY-MM-DD
     */
    const submitDecision = async (action) => {
        if (!selectedApplication || saving) {
            return;
        }

        if (
            !["approve", "reject"].includes(action)
        ) {
            return;
        }

        if (action === "approve") {
            if (
                !selectedApplication.documents?.length
            ) {
                setError(
                    "Нельзя подтвердить личность без документов"
                );
                return;
            }

            if (!documentsChecked) {
                setError(
                    "Подтвердите, что вы проверили документы"
                );
                return;
            }

            if (!validUntil) {
                setError(
                    "Укажите дату следующей проверки"
                );
                return;
            }
        }

        if (
            action === "reject" &&
            reason.trim().length < 5
        ) {
            setError(
                "Укажите причину отказа — минимум 5 символов"
            );
            return;
        }

        const confirmationText =
            action === "approve"
                ? "Вы действительно проверили документы и хотите подтвердить личность пользователя?"
                : "Отклонить заявку на подтверждение личности?";

        if (
            !window.confirm(confirmationText)
        ) {
            return;
        }

        try {
            setSaving(true);

            setError("");
            setSuccess("");

            await ensureAdminSession();

            const response =
                await axiosInstance.post(
                    `/admin/identity/${selectedApplication.id}/decision`,
                    {
                        action,

                        reason: reason.trim(),

                        ...(action === "approve"
                            ? { validUntil }
                            : {}),
                    }
                );

            setSuccess(
                response.data?.message ||
                "Решение успешно сохранено"
            );

            setSelectedId(null);

            setDocumentsChecked(false);

            setReason("");

            await loadApplications();

        } catch (err) {
            setError(
                getErrorMessage(err)
            );

        } finally {
            setSaving(false);
        }
    };


    return (
        <main className="admin-identity-page">
            <div className="admin-identity-container">

                <header className="admin-identity-header">
                    <div>
                        <Link
                            to="/dashboard"
                            className="admin-identity-back"
                        >
                            ← Панель администратора
                        </Link>

                        <h1>
                            Проверка личности
                        </h1>

                        <p>
                            Рассмотрение заявок на
                            подтверждение личности пользователей
                        </p>
                    </div>

                    <button
                        type="button"
                        className="admin-identity-refresh"
                        onClick={loadApplications}
                        disabled={loading || saving}
                    >
                        {loading
                            ? "Обновляем..."
                            : "Обновить"}
                    </button>
                </header>

                <VerifiedIdentityManagement />

                <section className="admin-identity-summary">
                    <div className="admin-identity-counter">
                        {applications.length}
                    </div>

                    <div>
                        <strong>
                            Ожидают проверки
                        </strong>

                        <p>
                            Показано до 50 заявок,
                            ожидающих решения администратора
                        </p>
                    </div>
                </section>


                {error && (
                    <div
                        className="admin-identity-error"
                        role="alert"
                    >
                        {error}
                    </div>
                )}


                {success && (
                    <div
                        className="admin-identity-success"
                        role="status"
                    >
                        {success}
                    </div>
                )}


                {loading ? (
                    <div className="admin-identity-empty">
                        Загружаем заявки...
                    </div>
                ) : applications.length === 0 ? (
                    <div className="admin-identity-empty">
                        <span
                            className="admin-identity-empty-icon"
                            aria-hidden="true"
                        >
                            ✓
                        </span>

                        <h2>
                            Все заявки рассмотрены
                        </h2>

                        <p>
                            Новых заявок на проверку
                            личности пока нет.
                        </p>
                    </div>
                ) : (
                    <div className="admin-identity-list">

                        {applications.map((application) => {
                            const isOpen =
                                String(selectedId) ===
                                String(application.id);

                            const documents =
                                Array.isArray(
                                    application.documents
                                )
                                    ? application.documents
                                    : [];

                            return (
                                <article
                                    className="admin-identity-card"
                                    key={application.id}
                                >
                                    <div className="admin-identity-card-top">
                                        <div className="admin-identity-card-info">
                                            <span className="admin-identity-badge">
                                                Ожидает проверки
                                            </span>

                                            <h2>
                                                {application.user?.username ||
                                                    "Пользователь"}
                                            </h2>

                                            <div className="admin-identity-meta">
                                                <span>
                                                    Пользователь ID:{" "}
                                                    {application.userId}
                                                </span>

                                                <span>
                                                    Заявка №{" "}
                                                    {application.id}
                                                </span>

                                                <span>
                                                    Телефон:{" "}
                                                    {application.user?.phone ||
                                                        "Не указан"}
                                                </span>

                                                <span>
                                                    Подана:{" "}
                                                    {formatDate(
                                                        application.createdAt
                                                    )}
                                                </span>

                                                <span>
                                                    Документов:{" "}
                                                    {documents.length}
                                                </span>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="admin-identity-open"
                                            aria-expanded={isOpen}
                                            onClick={() =>
                                                selectApplication(
                                                    application
                                                )
                                            }
                                            disabled={saving}
                                        >
                                            {isOpen
                                                ? "Свернуть"
                                                : "Рассмотреть"}
                                        </button>
                                    </div>


                                    {isOpen && (
                                        <div className="admin-identity-details">

                                            <h3>
                                                Документы пользователя
                                            </h3>

                                            <p className="admin-identity-help">
                                                Скачайте документы
                                                и проверьте их перед
                                                принятием решения.
                                            </p>

                                            {documents.length > 0 ? (
                                                <div className="admin-identity-documents">

                                                    {documents.map((file, index) => (
                                                        <div
                                                            className="admin-identity-document"
                                                            key={file.id}
                                                        >
                                                            <div>
                                                                <strong>
                                                                    Документ {index + 1}
                                                                </strong>

                                                                <small>
                                                                    {DOCUMENT_TYPES[
                                                                        file.documentType
                                                                        ] || "Документ"}
                                                                </small>

                                                                <small>
                                                                    {formatSize(
                                                                        file.fileSize
                                                                    )}
                                                                </small>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    downloadingId !== null
                                                                }
                                                                onClick={() =>
                                                                    downloadDocument(
                                                                        application,
                                                                        file
                                                                    )
                                                                }
                                                            >
                                                                {downloadingId ===
                                                                file.id
                                                                    ? "Загружаем..."
                                                                    : "Скачать"}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="admin-identity-warning">
                                                    К заявке не приложены
                                                    документы. Подтверждение
                                                    недоступно.
                                                </div>
                                            )}


                                            <label className="admin-identity-check">
                                                <input
                                                    type="checkbox"
                                                    checked={documentsChecked}
                                                    onChange={(event) =>
                                                        setDocumentsChecked(
                                                            event.target.checked
                                                        )
                                                    }
                                                />

                                                <span>
                                                    Я проверил документы
                                                    и ознакомился с
                                                    представленными сведениями
                                                </span>
                                            </label>


                                            <div className="admin-identity-form">

                                                <label>
                                                    Действует до

                                                    <input
                                                        type="date"
                                                        min={formatInputDate(
                                                            new Date()
                                                        )}
                                                        value={validUntil}
                                                        onChange={(event) =>
                                                            setValidUntil(
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </label>

                                                <label>
                                                    Причина отказа /
                                                    комментарий

                                                    <textarea
                                                        value={reason}
                                                        maxLength={500}
                                                        rows={4}
                                                        placeholder="Причина обязательна при отклонении заявки"
                                                        onChange={(event) =>
                                                            setReason(
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </label>
                                            </div>


                                            <div className="admin-identity-actions">
                                                <button
                                                    type="button"
                                                    className="admin-identity-approve"
                                                    disabled={
                                                        saving ||
                                                        !documents.length ||
                                                        !documentsChecked
                                                    }
                                                    onClick={() =>
                                                        submitDecision(
                                                            "approve"
                                                        )
                                                    }
                                                >
                                                    {saving
                                                        ? "Сохраняем..."
                                                        : "Подтвердить личность"}
                                                </button>

                                                <button
                                                    type="button"
                                                    className="admin-identity-reject"
                                                    disabled={saving}
                                                    onClick={() =>
                                                        submitDecision(
                                                            "reject"
                                                        )
                                                    }
                                                >
                                                    Отклонить заявку
                                                </button>
                                            </div>


                                            <p className="admin-identity-privacy">
                                                Документы содержат персональные
                                                данные. Не сохраняйте их в
                                                общедоступных папках и не
                                                передавайте третьим лицам.
                                                Не указывайте паспортные
                                                реквизиты в комментарии.
                                            </p>

                                        </div>
                                    )}
                                </article>
                            );
                        })}

                    </div>
                )}

            </div>
        </main>
    );
}

export default AdminIdentityPage;