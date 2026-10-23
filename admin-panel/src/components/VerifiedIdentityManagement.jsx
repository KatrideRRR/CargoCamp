
import React, {
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "../utils/adminSession";

import "../styles/VerifiedIdentityManagement.css";

async function ensureSession() {
    if (!isAdminTokenValid(60000)) {
        await refreshAdminSession();
    }
}

function dateText(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleString("ru-RU");
}

function errorText(error) {
    return (
        error.response?.data?.message ||
        error.message ||
        "Ошибка запроса"
    );
}

const ACTION_LABELS = {
    identity_application_approved:
        "Проверка подтверждена",

    identity_application_rejected:
        "Заявка отклонена",

    identity_verification_revoked:
        "Проверка отозвана",
};

export default function VerifiedIdentityManagement() {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("");
    const [page, setPage] = useState(1);

    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const [selectedId, setSelectedId] =
        useState(null);

    const [history, setHistory] =
        useState(null);

    const [historyLoading, setHistoryLoading] =
        useState(false);

    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const [revision, setRevision] =
        useState(0);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError("");

            try {
                await ensureSession();

                const response =
                    await axiosInstance.get(
                        "/admin/identity/verified",
                        {
                            params: {
                                q: filter,
                                page,
                            },
                        }
                    );

                if (!cancelled) {
                    setUsers(
                        response.data?.users || []
                    );

                    setTotal(
                        Number(
                            response.data?.total || 0
                        )
                    );
                }

            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        errorText(requestError)
                    );

                    setUsers([]);
                    setTotal(0);
                }

            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load();

        return () => {
            cancelled = true;
        };

    }, [filter, page, revision]);

    const totalPages = Math.max(
        1,
        Math.ceil(total / 20)
    );

    function search(event) {
        event.preventDefault();

        setPage(1);
        setFilter(query.trim());

        setSelectedId(null);
        setHistory(null);

        setRevision((value) => value + 1);
    }

    async function showHistory(row) {
        const id = String(row.userId);

        if (selectedId === id) {
            setSelectedId(null);
            setHistory(null);
            setReason("");
            return;
        }

        setSelectedId(id);
        setHistory(null);
        setReason("");
        setError("");

        try {
            setHistoryLoading(true);

            await ensureSession();

            const response =
                await axiosInstance.get(
                    `/admin/identity/users/${id}/history`
                );

            setHistory(response.data);

        } catch (requestError) {
            setError(
                errorText(requestError)
            );

        } finally {
            setHistoryLoading(false);
        }
    }

    async function revokeVerification(row) {
        if (busy) return;

        const trimmed = reason.trim();

        if (
            trimmed.length < 10 ||
            trimmed.length > 500
        ) {
            setError(
                "Причина отзыва: от 10 до 500 символов."
            );
            return;
        }

        const confirmed = window.confirm(
            `Отозвать проверку пользователя ` +
            `№${row.userId}?\n\n` +
            `После отзыва пользователь не сможет ` +
            `подписывать новые подтверждённые ` +
            `документы до повторной проверки личности.`
        );

        if (!confirmed) return;

        try {
            setBusy(true);
            setError("");
            setMessage("");

            await ensureSession();

            const response =
                await axiosInstance.post(
                    `/admin/identity/${row.verificationId}/revoke`,
                    {
                        reason: trimmed,
                    }
                );

            if (!response.data?.success) {
                throw new Error(
                    "Сервер не подтвердил отзыв"
                );
            }

            setMessage(
                `Верификация пользователя №${row.userId} ` +
                `отозвана. Действие записано в журнал.`
            );

            setSelectedId(null);
            setHistory(null);
            setReason("");

            setRevision(
                (value) => value + 1
            );

        } catch (requestError) {
            setError(
                errorText(requestError)
            );

        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="cc-verified-admin">
            <div className="cc-verified-admin-header">
                <div>
                    <h2>
                        Подтверждённые пользователи
                    </h2>

                    <p>
                        Действующие проверки личности,
                        отзыв и история решений.
                    </p>
                </div>

                <strong>
                    {total}
                </strong>
            </div>

            <form
                className="cc-verified-admin-search"
                onSubmit={search}
            >
                <input
                    type="search"
                    value={query}
                    maxLength={30}
                    onChange={(event) =>
                        setQuery(event.target.value)
                    }
                    placeholder="ID или номер телефона"
                    aria-label="Поиск верифицированных пользователей"
                />

                <button
                    type="submit"
                    disabled={loading || busy}
                >
                    Найти
                </button>

                <button
                    type="button"
                    disabled={loading || busy}
                    onClick={() => {
                        setQuery("");
                        setFilter("");
                        setPage(1);
                        setRevision(
                            (value) => value + 1
                        );
                    }}
                >
                    Сбросить
                </button>
            </form>

            {error && (
                <p
                    className="cc-verified-admin-error"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {message && (
                <p
                    className="cc-verified-admin-success"
                    role="status"
                >
                    {message}
                </p>
            )}

            {loading ? (
                <p>Загружаем пользователей…</p>
            ) : users.length === 0 ? (
                <p className="cc-verified-admin-empty">
                    Действующие подтверждения
                    не найдены.
                </p>
            ) : (
                <div className="cc-verified-admin-list">
                    {users.map((row) => {
                        const expanded =
                            selectedId ===
                            String(row.userId);

                        return (
                            <article
                                key={row.verificationId}
                                className="cc-verified-admin-card"
                            >
                                <div className="cc-verified-admin-person">
                                    <div>
                                        <strong>
                                            {row.username}
                                        </strong>

                                        <p>
                                            ID: {row.userId}
                                            {" · "}
                                            {row.phone}
                                        </p>

                                        <small>
                                            Проверка №
                                            {row.verificationId}
                                        </small>
                                    </div>

                                    <span className="cc-verified-admin-badge">
                                        Действует
                                    </span>
                                </div>

                                <div className="cc-verified-admin-dates">
                                    <span>
                                        Подтверждена:{" "}
                                        {dateText(
                                            row.verifiedAt
                                        )}
                                    </span>

                                    <span>
                                        Действует до:{" "}
                                        {dateText(
                                            row.expiresAt
                                        )}
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() =>
                                        showHistory(row)
                                    }
                                    disabled={busy}
                                >
                                    {expanded
                                        ? "Закрыть сведения"
                                        : "История и управление"}
                                </button>

                                {expanded && (
                                    <div className="cc-verified-admin-details">
                                        {historyLoading && (
                                            <p>
                                                Загружаем историю…
                                            </p>
                                        )}

                                        {history && (
                                            <>
                                                <h3>
                                                    История проверок
                                                </h3>

                                                {history.verifications
                                                    ?.map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className="cc-verified-admin-history"
                                                        >
                                                            <strong>
                                                                Проверка №
                                                                {item.id}
                                                            </strong>

                                                            <span>
                                                                Статус:{" "}
                                                                {item.status}
                                                            </span>

                                                            <span>
                                                                {dateText(
                                                                    item.createdAt
                                                                )}
                                                            </span>

                                                            {item.rejectionReason && (
                                                                <p>
                                                                    Причина:{" "}
                                                                    {item.rejectionReason}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))}

                                                <h3>
                                                    Журнал решений
                                                </h3>

                                                {history.actions
                                                    ?.length ? (
                                                    history.actions.map(
                                                        (action) => (
                                                            <div
                                                                key={action.id}
                                                                className="cc-verified-admin-history"
                                                            >
                                                                <strong>
                                                                    {ACTION_LABELS[
                                                                        action.actionType
                                                                        ] || action.actionType}
                                                                </strong>

                                                                <span>
                                                                    Администратор №
                                                                    {action.actorUserId}
                                                                </span>

                                                                <span>
                                                                    {dateText(
                                                                        action.ts
                                                                    )}
                                                                </span>

                                                                {action.reason && (
                                                                    <p>
                                                                        {action.reason}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )
                                                    )
                                                ) : (
                                                    <p>
                                                        Записей пока нет.
                                                    </p>
                                                )}
                                            </>
                                        )}

                                        <div className="cc-verified-admin-revoke">
                                            <h3>
                                                Отозвать подтверждение
                                            </h3>

                                            <p>
                                                Требуется обоснованная
                                                причина. Отзыв не удаляет
                                                ранее оформленные документы.
                                            </p>

                                            <textarea
                                                rows={3}
                                                maxLength={500}
                                                value={reason}
                                                disabled={busy}
                                                placeholder="Причина отзыва (не менее 10 символов)"
                                                onChange={(event) =>
                                                    setReason(
                                                        event.target.value
                                                    )
                                                }
                                            />

                                            <button
                                                type="button"
                                                className="danger"
                                                disabled={
                                                    busy ||
                                                    reason.trim().length < 10
                                                }
                                                onClick={() =>
                                                    revokeVerification(row)
                                                }
                                            >
                                                {busy
                                                    ? "Сохраняем…"
                                                    : "Отозвать верификацию"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            <div className="cc-verified-admin-pagination">
                <button
                    type="button"
                    disabled={
                        loading ||
                        busy ||
                        page <= 1
                    }
                    onClick={() =>
                        setPage(page - 1)
                    }
                >
                    ← Назад
                </button>

                <span>
                    Страница {page} из {totalPages}
                </span>

                <button
                    type="button"
                    disabled={
                        loading ||
                        busy ||
                        page >= totalPages
                    }
                    onClick={() =>
                        setPage(page + 1)
                    }
                >
                    Далее →
                </button>
            </div>

            <p className="cc-verified-admin-footnote">
                Доступ ограничен администраторами.
                Паспортные документы здесь не
                передаются и не отображаются.
            </p>
        </section>
    );
}
