import React, {
    useCallback,
    useEffect,
    useState,
} from "react";

import axios from "axios";
import axiosInstance from "../utils/axiosInstance";

import "../styles/UserBenefitsSection.css";

const apiUrl = process.env.REACT_APP_API_URL;

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const BENEFIT_PROGRAMS = [
    {
        code: "pension_recipient",
        icon: "👴",
        title: "Пенсионер",
        description:
            "Подтверждение пенсионного статуса",
    },
    {
        code: "disability_status",
        icon: "🛡️",
        title: "Льгота по инвалидности",
        description:
            "Подтверждение права на социальную льготу",
    },
    {
        code: "large_family_parent",
        icon: "👨‍👩‍👧‍👦",
        title: "Многодетная семья",
        description:
            "Подтверждение статуса многодетной семьи",
    },
];

const STATUS_INFO = {
    not_requested: {
        title: "Не подтверждена",
        description: "Можно отправить документы на проверку.",
    },
    pending: {
        title: "На проверке",
        description:
            "Документы получены. Ожидается решение администратора.",
    },
    verified: {
        title: "Подтверждена",
        description:
            "Право на льготу подтверждено CargoCamp.",
    },
    rejected: {
        title: "Отклонена",
        description:
            "Проверка не пройдена. Можно отправить новую заявку.",
    },
    expired: {
        title: "Требуется повторная проверка",
        description:
            "Срок подтверждения истёк. Отправьте актуальный документ.",
    },
    revoked: {
        title: "Подтверждение отозвано",
        description:
            "Можно обратиться в поддержку или подать новую заявку.",
    },
};

const CAN_APPLY = new Set([
    "not_requested",
    "rejected",
    "expired",
    "revoked",
]);

function getErrorMessage(error) {
    if (error?.response?.status === 413) {
        return "Максимальный размер документа — 5 МБ.";
    }

    return (
        error?.response?.data?.message ||
        "Не удалось выполнить запрос. Попробуйте ещё раз."
    );
}

function formatDate(value) {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toLocaleDateString("ru-RU");
}

function validateFile(file) {
    if (!file) {
        return "Выберите документ.";
    }

    if (file.size <= 0) {
        return "Выбранный файл пуст.";
    }

    if (file.size > MAX_FILE_SIZE) {
        return "Максимальный размер документа — 5 МБ.";
    }

    const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
    ];

    const allowedExtension =
        /\.(pdf|jpe?g|png)$/i.test(file.name);

    if (
        !allowedTypes.includes(file.type) &&
        !(file.type === "" && allowedExtension)
    ) {
        return "Разрешены PDF, JPG и PNG.";
    }

    return null;
}

function UserBenefitsSection({
                                 userId,
                                 legacyUserStatus,
                                 embedded = false,
                             }) {
    const [benefits, setBenefits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [selectedFiles, setSelectedFiles] =
        useState({});

    const [uploadingCode, setUploadingCode] =
        useState(null);

    const [opened, setOpened] = useState(false);

    const loadBenefits = useCallback(async () => {
        if (!userId) {
            setBenefits([]);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError("");

            const response = await axiosInstance.get(
                "/benefits/me"
            );

            const list = response.data?.benefits;

            setBenefits(
                Array.isArray(list) ? list : []
            );
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadBenefits();
    }, [loadBenefits]);

    useEffect(() => {
        const handleRefresh = () => {
            if (opened) {
                loadBenefits();
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
    }, [opened, loadBenefits]);

    const handleSelectFile = (code, file) => {
        setError("");
        setSuccess("");

        if (!file) {
            return;
        }

        const validationError = validateFile(file);

        if (validationError) {
            setError(validationError);

            setSelectedFiles((previous) => ({
                ...previous,
                [code]: null,
            }));

            return;
        }

        setSelectedFiles((previous) => ({
            ...previous,
            [code]: file,
        }));
    };

    const handleSubmit = async (code) => {
        if (uploadingCode) return;

        const file = selectedFiles[code];

        const validationError = validateFile(file);

        if (validationError) {
            setError(validationError);
            return;
        }

        const program = BENEFIT_PROGRAMS.find(
            (item) => item.code === code
        );

        const confirmed = window.confirm(
            `Отправить документ для проверки категории «${program?.title || code}»?`
        );

        if (!confirmed) return;

        try {
            setUploadingCode(code);
            setError("");
            setSuccess("");

            const formData = new FormData();

            formData.append("document", file);

            /*
             * Здесь используем обычный axios.
             *
             * В CargoCamp к нему уже подключён
             * общий auth-interceptor.
             *
             * Загрузка multipart должна идти через
             * XHR, а не через iOS JSON-адаптер
             * CapacitorHttp.
             *
             * Content-Type вручную не устанавливаем:
             * браузер должен добавить boundary.
             */
            await axios.post(
                `${apiUrl}/api/benefits/me/${encodeURIComponent(code)}/apply`,
                formData,
                {
                    timeout: 60000,
                }
            );

            setSelectedFiles((previous) => ({
                ...previous,
                [code]: null,
            }));

            setSuccess(
                "Документ успешно отправлен. Заявка ожидает проверки."
            );

            await loadBenefits();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setUploadingCode(null);
        }
    };

    const benefitsByCode = Object.fromEntries(
        benefits.map((item) => [
            item.code,
            item,
        ])
    );

    const confirmedCount = benefits.filter(
        (item) => item.status === "verified"
    ).length;

    const pendingCount = benefits.filter(
        (item) => item.status === "pending"
    ).length;

    return (
        <section
            className={
                embedded
                    ? "verification-panel cc-benefits cc-benefits--embedded"
                    : "profile-card glass cc-benefits"
            }
        >
            <button
                type="button"
                className="verification-panel-head cc-benefits-heading"
                aria-expanded={opened}
                onClick={() => setOpened((prev) => !prev)}
            >
    <span className="verification-panel-head-main">
        <span
            className="verification-panel-icon"
            aria-hidden="true"
        >
            🎖️
        </span>

        <span className="verification-panel-heading">
            <span className="verification-panel-title">
                Социальные льготы
            </span>

            <span className="verification-panel-subtitle">
                Пенсионеры, инвалидность, многодетные семьи
            </span>
        </span>
    </span>

                <span className="verification-panel-head-side">
        <span
            className={`cc-benefits-header-status ${
                confirmedCount > 0
                    ? "is-verified"
                    : pendingCount > 0
                        ? "is-pending"
                        : ""
            }`}
        >
            {loading
                ? "Загрузка..."
                : error && benefits.length === 0
                    ? "Ошибка загрузки"
                    : confirmedCount > 0
                        ? `Подтверждено: ${confirmedCount}`
                        : pendingCount > 0
                            ? `На проверке: ${pendingCount}`
                            : "Нет льгот"}
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
                <div className="verification-panel-content cc-benefits-content">
                    <div className="cc-benefits-summary">
            <span>
                Подтверждено:{" "}
                <strong>{confirmedCount}</strong>
            </span>

                        <span>
                На проверке:{" "}
                            <strong>{pendingCount}</strong>
            </span>
                    </div>

                    <p className="cc-benefits-intro">
                        Вы можете подтвердить право на
                        льготы. Проверка добровольная и
                        не обязательна для выполнения
                        обычных заказов.
                    </p>

                    {legacyUserStatus === "pensioner" &&
                        benefitsByCode.pension_recipient
                            ?.status !== "verified" && (
                            <div className="cc-benefits-legacy">
                                Ранее вам был назначен
                                пенсионный статус.
                                Перенос старых статусов
                                в новую систему ещё не
                                завершён. Действующие
                                правила комиссии пока
                                не меняются.
                            </div>
                        )}

                    {error && (
                        <div
                            className="cc-benefits-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}

                    {success && (
                        <div
                            className="cc-benefits-success"
                            role="status"
                        >
                            {success}
                        </div>
                    )}

                    {loading ? (
                        <p className="cc-benefits-loading">
                            Загружаем статусы льгот...
                        </p>
                    ) : (
                        <div className="cc-benefits-list">
                            {BENEFIT_PROGRAMS.map((program) => {
                                const benefit =
                                    benefitsByCode[program.code];

                                const status =
                                    benefit?.status ||
                                    "not_requested";

                                const statusInfo =
                                    STATUS_INFO[status] ||
                                    STATUS_INFO.not_requested;

                                const canApply =
                                    CAN_APPLY.has(status);

                                const file =
                                    selectedFiles[program.code];

                                const isUploading =
                                    uploadingCode ===
                                    program.code;

                                const verifiedDate =
                                    formatDate(
                                        benefit?.verifiedAt
                                    );

                                const expiresDate =
                                    formatDate(
                                        benefit?.expiresAt
                                    );

                                return (
                                    <article
                                        className="cc-benefit-item"
                                        key={program.code}
                                    >
                                        <div className="cc-benefit-top">
                                            <span
                                                className="cc-benefit-icon"
                                                aria-hidden="true"
                                            >
                                                {program.icon}
                                            </span>

                                            <div className="cc-benefit-details">
                                                <strong>
                                                    {program.title}
                                                </strong>

                                                <small>
                                                    {program.description}
                                                </small>
                                            </div>
                                        </div>

                                        <div
                                            className={
                                                `cc-benefit-status cc-benefit-status--${status}`
                                            }
                                        >
                                            {statusInfo.title}
                                        </div>

                                        <p className="cc-benefit-description">
                                            {statusInfo.description}
                                        </p>

                                        {status === "verified" &&
                                            verifiedDate && (
                                                <p className="cc-benefit-date">
                                                    Подтверждено:{" "}
                                                    {verifiedDate}
                                                </p>
                                            )}

                                        {status === "verified" &&
                                            expiresDate && (
                                                <p className="cc-benefit-date">
                                                    Повторная проверка до:{" "}
                                                    {expiresDate}
                                                </p>
                                            )}

                                        {canApply && (
                                            <div className="cc-benefit-upload">
                                                <div className="cc-benefit-file-label">
                                                    Подтверждающий документ
                                                </div>

                                                <input
                                                    id={`cc-benefit-file-${program.code}`}
                                                    className="cc-benefit-file-input"
                                                    type="file"
                                                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                                    disabled={Boolean(uploadingCode)}
                                                    onChange={(event) => {
                                                        handleSelectFile(
                                                            program.code,
                                                            event.target.files?.[0]
                                                        );

                                                        event.target.value = "";
                                                    }}
                                                />

                                                <label
                                                    htmlFor={`cc-benefit-file-${program.code}`}
                                                    className={`cc-benefit-file-picker ${
                                                        uploadingCode ? "is-disabled" : ""
                                                    }`}
                                                >
                                                    <span aria-hidden="true">📎</span>

                                                    Выбрать файл
                                                </label>

                                                <small className="cc-benefit-file-hint">
                                                    PDF, JPG или PNG,
                                                    до 5 МБ.
                                                </small>

                                                {file && (
                                                    <p className="cc-benefit-filename">
                                                        Выбран: {file.name}
                                                    </p>
                                                )}

                                                <button
                                                    type="button"
                                                    className="cc-benefit-submit"
                                                    disabled={
                                                        !file ||
                                                        Boolean(
                                                            uploadingCode
                                                        )
                                                    }
                                                    onClick={() =>
                                                        handleSubmit(
                                                            program.code
                                                        )
                                                    }
                                                >
                                                    {isUploading
                                                        ? "Отправляем..."
                                                        : "Отправить на проверку"}
                                                </button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}

                    <div className="cc-benefits-footer">
                        <p>
                            Документы доступны только
                            для предусмотренной проверки.
                            Не прикладывайте сведения,
                            которые не требуются для
                            подтверждения льготы.
                        </p>

                        <button
                            type="button"
                            onClick={loadBenefits}
                            disabled={
                                loading ||
                                Boolean(uploadingCode)
                            }
                        >
                            Обновить статусы
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

export default UserBenefitsSection;