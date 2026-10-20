
import React, {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";

import axios from "axios";
import axiosInstance from "../utils/axiosInstance";

import "../styles/UserIdentityVerification.css";

const apiUrl = process.env.REACT_APP_API_URL;

const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
];

const CAN_APPLY = new Set([
    "not_requested",
    "rejected",
    "expired",
    "revoked",
]);

const STATUS = {
    not_requested: {
        title: "Не подтверждена",
        className: "empty",
        description:
            "Подтверждение личности пока не выполнено.",
    },
    pending: {
        title: "На проверке",
        className: "pending",
        description:
            "Документы отправлены. Ожидается решение администратора.",
    },
    verified: {
        title: "Подтверждена",
        className: "verified",
        description:
            "Личность подтверждена после ручной проверки документов.",
    },
    rejected: {
        title: "Отклонена",
        className: "rejected",
        description:
            "Заявка отклонена. Можно отправить документы повторно.",
    },
    expired: {
        title: "Истёк срок",
        className: "pending",
        description:
            "Необходимо повторно подтвердить личность.",
    },
    revoked: {
        title: "Отозвана",
        className: "rejected",
        description:
            "Подтверждение отозвано. Можно обратиться в поддержку.",
    },
};

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleDateString("ru-RU");
}

function getErrorMessage(error) {
    if (error?.response?.status === 413) {
        return "Максимум 3 файла размером до 5 МБ каждый.";
    }

    if (error?.response?.status === 401) {
        return "Сессия завершена. Авторизуйтесь повторно.";
    }

    return (
        error?.response?.data?.message ||
        "Не удалось выполнить запрос. Попробуйте повторно."
    );
}

function validateFiles(files) {
    if (!files.length) {
        return "Выберите хотя бы один документ.";
    }

    if (files.length > MAX_FILES) {
        return "Можно приложить не более трёх файлов.";
    }

    for (const file of files) {
        if (!file.size || file.size > MAX_FILE_SIZE) {
            return `Файл «${file.name}» должен быть не больше 5 МБ.`;
        }

        const extensionAllowed =
            /\.(pdf|jpe?g|png)$/i.test(file.name);

        if (
            !ALLOWED_TYPES.includes(file.type) &&
            !(file.type === "" && extensionAllowed)
        ) {
            return "Поддерживаются только PDF, JPG и PNG.";
        }
    }

    return null;
}

export default function UserIdentityVerification({
                                                     userId,
                                                     legacyUserStatus,
                                                 }) {
    const inputId = useId();
    const submittingRef = useRef(false);

    const [opened, setOpened] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [verification, setVerification] = useState(null);
    const [loadError, setLoadError] = useState("");
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState("");

    const [documentType, setDocumentType] =
        useState("passport_rf");

    const [files, setFiles] = useState([]);
    const [confirmed, setConfirmed] = useState(false);

    const loadStatus = useCallback(async () => {
        if (!userId) {
            setVerification(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setLoadError("");

            const response = await axiosInstance.get(
                "/identity/me"
            );

            if (!response.data?.success) {
                throw new Error(
                    "Сервер не подтвердил получение статуса"
                );
            }

            setVerification(
                response.data.verification || null
            );
        } catch (error) {
            setLoadError(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        const handleRefresh = () => {
            if (opened && !submittingRef.current) {
                loadStatus();
            }
        };

        window.addEventListener(
            "appPullToRefresh",
            handleRefresh
        );

        return () => {
            window.removeEventListener(
                "appPullToRefresh",
                handleRefresh
            );
        };
    }, [opened, loadStatus]);

    const status = verification?.status || "not_requested";

    const statusInfo = STATUS[status] || STATUS.not_requested;

    const canApply =
        !loading &&
        !loadError &&
        Boolean(userId) &&
        CAN_APPLY.has(status);

    const handleSelectFiles = (event) => {
        const selected = Array.from(
            event.target.files || []
        );

        // Файлы храним только в состоянии компонента.
        event.target.value = "";

        setFormError("");
        setSuccess("");

        if (!selected.length) return;

        const nextFiles = [...files, ...selected];
        const validationError = validateFiles(nextFiles);

        if (validationError) {
            setFormError(validationError);
            return;
        }

        setFiles(nextFiles);
    };

    const removeFile = (index) => {
        setFiles((previous) =>
            previous.filter((_, i) => i !== index)
        );

        setFormError("");
    };

    const handleSubmit = async () => {
        if (
            submittingRef.current ||
            submitting ||
            !canApply
        ) {
            return;
        }

        const validationError = validateFiles(files);

        if (validationError) {
            setFormError(validationError);
            return;
        }

        if (!confirmed) {
            setFormError(
                "Подтвердите отправку документов для проверки личности."
            );
            return;
        }

        if (
            !window.confirm(
                "Отправить документы на проверку личности?"
            )
        ) {
            return;
        }

        submittingRef.current = true;

        try {
            setSubmitting(true);
            setFormError("");
            setSuccess("");

            const formData = new FormData();

            formData.append(
                "documentType",
                documentType
            );

            files.forEach((file) => {
                formData.append("documents", file);
            });

            /*
             * Обычный Axios использует XHR.
             * В CargoCamp к нему уже подключены
             * перехватчики пользовательской сессии.
             *
             * Не устанавливаем Content-Type вручную:
             * boundary для multipart создаётся
             * автоматически.
             *
             * Не используем iOS JSON-адаптер
             * CapacitorHttp для этой загрузки.
             */
            await axios.post(
                `${apiUrl}/api/identity/me/apply`,
                formData,
                {
                    timeout: 60000,
                    adapter: "xhr",
                }
            );

            setFiles([]);
            setConfirmed(false);

            setSuccess(
                "Документы отправлены на проверку."
            );

            await loadStatus();
        } catch (error) {
            setFormError(getErrorMessage(error));
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <section className="verification-panel cc-identity">
            <button
                type="button"
                className="verification-panel-head"
                aria-expanded={opened}
                aria-controls={`${inputId}-content`}
                onClick={() => setOpened((prev) => !prev)}
            >
                <span className="verification-panel-head-main">
                    <span
                        className="verification-panel-icon"
                        aria-hidden="true"
                    >
                        👤
                    </span>

                    <span className="verification-panel-heading">
                        <span className="verification-panel-title">
                            Подтверждение личности
                        </span>

                        <span className="verification-panel-subtitle">
                            Для подтверждённых сделок
                            и дополнительного доверия
                        </span>
                    </span>
                </span>

                <span className="verification-panel-head-side">
                    <span
                        className={
                            "verification-summary-status " +
                            (loadError
                                ? "rejected"
                                : statusInfo.className)
                        }
                    >
                        {loading
                            ? "Загрузка..."
                            : loadError
                                ? "Ошибка"
                                : statusInfo.title}
                    </span>

                    <span
                        className={`verification-chevron ${
                            opened ? "open" : ""
                        }`}
                        aria-hidden="true"
                    >
                        ›
                    </span>
                </span>
            </button>

            {opened && (
                <div
                    id={`${inputId}-content`}
                    className="verification-panel-content cc-identity-content"
                >
                    <div className="verification-info-box">
                        <strong>
                            Проверка личности CargoCamp
                        </strong>

                        <span>
                            Процедура добровольная.
                            Обычные заказы доступны
                            без подтверждения личности.
                            Документы проверяются вручную.
                        </span>
                    </div>

                    {loadError && (
                        <div className="cc-identity-error" role="alert">
                            {loadError}
                        </div>
                    )}

                    {formError && (
                        <div className="cc-identity-error" role="alert">
                            {formError}
                        </div>
                    )}

                    {success && (
                        <div className="cc-identity-success" role="status">
                            {success}
                        </div>
                    )}

                    {!loadError && !loading && (
                        <div className="cc-identity-status-detail">
                            <strong>{statusInfo.title}</strong>
                            <p>{statusInfo.description}</p>

                            {status === "verified" && (
                                <>
                                    {verification?.verifiedAt && (
                                        <p>
                                            Подтверждено:{" "}
                                            {formatDate(
                                                verification.verifiedAt
                                            )}
                                        </p>
                                    )}

                                    {verification?.expiresAt && (
                                        <p>
                                            Действует до:{" "}
                                            {formatDate(
                                                verification.expiresAt
                                            )}
                                        </p>
                                    )}
                                </>
                            )}

                            {status === "rejected" &&
                                verification?.rejectionReason && (
                                    <p className="cc-identity-reason">
                                        Причина отказа:{" "}
                                        {verification.rejectionReason}
                                    </p>
                                )}
                        </div>
                    )}

                    {legacyUserStatus === "verified" &&
                        status !== "verified" && (
                            <div className="cc-identity-legacy">
                                В профиле ранее был назначен
                                статус проверки личности.
                                Новая система учитывает
                                отдельные заявки, поэтому
                                старый статус пока не
                                переносится автоматически.
                            </div>
                        )}

                    {canApply && (
                        <div className="cc-identity-form">
                            <label className="cc-identity-field">
                                Тип документа

                                <select
                                    value={documentType}
                                    disabled={submitting}
                                    onChange={(event) =>
                                        setDocumentType(
                                            event.target.value
                                        )
                                    }
                                >
                                    <option value="passport_rf">
                                        Паспорт РФ
                                    </option>

                                    <option value="other_identity_document">
                                        Другой документ, удостоверяющий личность
                                    </option>
                                </select>
                            </label>

                            <div className="cc-identity-upload">
                                <span className="cc-identity-field-title">
                                    Фото или скан документа
                                </span>

                                <input
                                    id={inputId}
                                    type="file"
                                    className="cc-identity-file-input"
                                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                    multiple
                                    disabled={
                                        submitting ||
                                        files.length >= MAX_FILES
                                    }
                                    onChange={handleSelectFiles}
                                />

                                <label
                                    htmlFor={inputId}
                                    className={`cc-identity-file-picker ${
                                        submitting ||
                                        files.length >= MAX_FILES
                                            ? "is-disabled"
                                            : ""
                                    }`}
                                >
                                    <span aria-hidden="true">📎</span>
                                    Выбрать файлы
                                </label>

                                <small>
                                    От 1 до 3 файлов. PDF, JPG или PNG,
                                    до 5 МБ каждый.
                                </small>

                                {files.length > 0 && (
                                    <div className="cc-identity-files">
                                        {files.map((file, index) => (
                                            <div
                                                className="cc-identity-file-row"
                                                key={`${file.name}-${index}`}
                                            >
                                                <span>
                                                    {index + 1}. {file.name}
                                                </span>

                                                <button
                                                    type="button"
                                                    disabled={submitting}
                                                    onClick={() =>
                                                        removeFile(index)
                                                    }
                                                    aria-label={
                                                        `Убрать файл ${file.name}`
                                                    }
                                                >
                                                    Убрать
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <label className="cc-identity-confirm">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    disabled={submitting}
                                    onChange={(event) =>
                                        setConfirmed(event.target.checked)
                                    }
                                />

                                <span>
                                    Подтверждаю, что отправляю
                                    свои документы для проверки
                                    личности в CargoCamp.
                                </span>
                            </label>

                            <button
                                type="button"
                                className="cc-identity-submit"
                                disabled={
                                    submitting ||
                                    !confirmed ||
                                    files.length === 0
                                }
                                onClick={handleSubmit}
                            >
                                {submitting
                                    ? "Отправляем..."
                                    : "Отправить на проверку"}
                            </button>
                        </div>
                    )}

                    {status === "pending" && !loadError && (
                        <p className="cc-identity-note">
                            Повторная подача будет доступна
                            после рассмотрения заявки.
                        </p>
                    )}

                    <button
                        type="button"
                        className="cc-identity-refresh"
                        onClick={loadStatus}
                        disabled={loading || submitting}
                    >
                        {loading
                            ? "Обновляем..."
                            : "Обновить статус"}
                    </button>
                </div>
            )}
        </section>
    );
}
