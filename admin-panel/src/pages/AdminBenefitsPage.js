import React, {
    useCallback,
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "../utils/adminSession";

import "../styles/AdminBenefitsPage.css";

const BENEFIT_NAMES = {
    pension_recipient: "Пенсионер",
    disability_status: "Инвалидность",
    large_family_parent: "Многодетная семья",
};

const formatDate = (value) => {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleString("ru-RU");
};

async function ensureAdminSession() {
    if (!isAdminTokenValid(60_000)) {
        await refreshAdminSession();
    }
}

function getErrorMessage(error) {
    return (
        error?.response?.data?.message ||
        "Не удалось выполнить запрос"
    );
}

function AdminBenefitsPage() {
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedId, setSelectedId] = useState(null);
    const [reason, setReason] = useState("");
    const [validUntil, setValidUntil] = useState("");

    const [saving, setSaving] = useState(false);
    const [downloadingId, setDownloadingId] = useState(null);

    const loadApplications = useCallback(async () => {
        try {
            setLoading(true);
            setError("");

            await ensureAdminSession();

            const response = await axiosInstance.get(
                "/admin/benefits/pending"
            );

            const items = response.data?.applications;

            setApplications(
                Array.isArray(items) ? items : []
            );
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadApplications();
    }, [loadApplications]);

    const selectedApplication =
        applications.find(
            (item) => String(item.id) === String(selectedId)
        ) || null;

    const selectApplication = (application) => {
        if (String(selectedId) === String(application.id)) {
            setSelectedId(null);
            return;
        }

        setSelectedId(application.id);
        setReason("");
        setValidUntil("");
        setError("");
    };

    const downloadDocument = async (
        application,
        document
    ) => {
        try {
            setDownloadingId(document.id);
            setError("");

            await ensureAdminSession();

            const response = await axiosInstance.get(
                `/admin/benefits/${application.id}/document/${document.id}`,
                {
                    responseType: "blob",
                }
            );

            const mimeType = String(
                document.mimeType || ""
            );

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

            const objectUrl = URL.createObjectURL(blob);

            const link = window.document.createElement("a");

            link.href = objectUrl;
            link.download =
                `benefit-${application.id}-document-${document.id}.${extension}`;

            window.document.body.appendChild(link);
            link.click();
            link.remove();

            setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 1000);
        } catch (err) {
            setError(
                "Не удалось получить документ. " +
                getErrorMessage(err)
            );
        } finally {
            setDownloadingId(null);
        }
    };

    const submitDecision = async (action) => {
        if (!selectedApplication) return;

        if (action === "approve" && !validUntil) {
            setError(
                "Укажите дату следующей проверки льготы"
            );
            return;
        }

        if (
            action === "reject" &&
            reason.trim().length < 5
        ) {
            setError(
                "Укажите причину отклонения — минимум 5 символов"
            );
            return;
        }

        const confirmed = window.confirm(
            action === "approve"
                ? "Подтвердить льготу пользователя?"
                : "Отклонить заявку?"
        );

        if (!confirmed) return;

        try {
            setSaving(true);
            setError("");

            await ensureAdminSession();

            await axiosInstance.post(
                `/admin/benefits/${selectedApplication.id}/decision`,
                {
                    action,
                    reason: reason.trim(),
                    ...(action === "approve"
                        ? { validUntil }
                        : {}),
                }
            );

            setSelectedId(null);
            setReason("");
            setValidUntil("");

            await loadApplications();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="admin-benefits-page">
            <div className="admin-benefits-container">
                <header className="admin-benefits-header">
                    <div>
                        <h1>Проверка льгот</h1>
                        <p>
                            Пенсионеры, люди с инвалидностью
                            и многодетные семьи
                        </p>
                    </div>

                    <button
                        type="button"
                        className="admin-benefits-refresh"
                        onClick={loadApplications}
                        disabled={loading}
                    >
                        {loading
                            ? "Обновляем..."
                            : "Обновить"}
                    </button>
                </header>

                <section className="admin-benefits-summary">
                    <div className="admin-benefits-summary-value">
                        {applications.length}
                    </div>

                    <div>
                        <strong>Ожидают проверки</strong>
                        <p>
                            Заявки, по которым ещё
                            не принято решение
                        </p>
                    </div>
                </section>

                {error && (
                    <div
                        className="admin-benefits-error"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                {loading ? (
                    <p>Загружаем заявки...</p>
                ) : applications.length === 0 ? (
                    <div className="admin-benefits-empty">
                        Новых заявок пока нет
                    </div>
                ) : (
                    <div className="admin-benefits-list">
                        {applications.map((application) => {
                            const isOpen =
                                String(selectedId) ===
                                String(application.id);

                            return (
                                <article
                                    className="admin-benefits-card"
                                    key={application.id}
                                >
                                    <div className="admin-benefits-card-top">
                                        <div>
                                            <span className="admin-benefits-badge">
                                                {BENEFIT_NAMES[
                                                    application.benefitCode
                                                    ] || application.benefitCode}
                                            </span>

                                            <h2>
                                                {application.user?.username ||
                                                    "Пользователь"}
                                            </h2>

                                            <p>
                                                ID пользователя:{" "}
                                                {application.userId}
                                            </p>

                                            <p>
                                                Телефон:{" "}
                                                {application.user?.phone ||
                                                    "Не указан"}
                                            </p>

                                            <p>
                                                Подана:{" "}
                                                {formatDate(
                                                    application.submittedAt
                                                )}
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            className="admin-benefits-open"
                                            onClick={() =>
                                                selectApplication(application)
                                            }
                                        >
                                            {isOpen
                                                ? "Свернуть"
                                                : "Рассмотреть"}
                                        </button>
                                    </div>

                                    {isOpen && selectedApplication && (
                                        <div className="admin-benefits-details">
                                            <h3>Документы</h3>

                                            {application.documents?.length ? (
                                                <div className="admin-benefits-documents">
                                                    {application.documents.map(
                                                        (file) => (
                                                            <button
                                                                type="button"
                                                                key={file.id}
                                                                onClick={() =>
                                                                    downloadDocument(
                                                                        application,
                                                                        file
                                                                    )
                                                                }
                                                                disabled={
                                                                    downloadingId ===
                                                                    file.id
                                                                }
                                                            >
                                                                {downloadingId ===
                                                                file.id
                                                                    ? "Загружаем..."
                                                                    : `Получить документ №${file.id}`}
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                            ) : (
                                                <p>
                                                    Документы отсутствуют
                                                </p>
                                            )}

                                            <label className="admin-benefits-label">
                                                Дата следующей проверки
                                                <input
                                                    type="date"
                                                    value={validUntil}
                                                    onChange={(e) =>
                                                        setValidUntil(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </label>

                                            <label className="admin-benefits-label">
                                                Комментарий к решению
                                                <textarea
                                                    value={reason}
                                                    maxLength={500}
                                                    rows={3}
                                                    placeholder="Причина отклонения или служебный комментарий"
                                                    onChange={(e) =>
                                                        setReason(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </label>

                                            <div className="admin-benefits-actions">
                                                <button
                                                    type="button"
                                                    className="admin-benefits-approve"
                                                    disabled={
                                                        saving ||
                                                        !application.documents?.length
                                                    }
                                                    onClick={() =>
                                                        submitDecision(
                                                            "approve"
                                                        )
                                                    }
                                                >
                                                    Подтвердить
                                                </button>

                                                <button
                                                    type="button"
                                                    className="admin-benefits-reject"
                                                    disabled={saving}
                                                    onClick={() =>
                                                        submitDecision(
                                                            "reject"
                                                        )
                                                    }
                                                >
                                                    Отклонить
                                                </button>
                                            </div>

                                            <p className="admin-benefits-privacy">
                                                Не указывайте диагнозы
                                                или другую чувствительную
                                                информацию в комментариях.
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

export default AdminBenefitsPage;