
import React, {
    useCallback,
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import "../styles/ActRemediationPanel.css";

export default function ActRemediationPanel({
                                                act,
                                                refreshKey = 0,
                                                onRevised,
                                            }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const [comment, setComment] = useState("");
    const [approved, setApproved] = useState(true);
    const [confirmed, setConfirmed] = useState(false);

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const actId = act?.id;

    const base =
        `/contracts/acts/${actId}/remediation`;

    const refresh = useCallback(async () => {
        if (!actId) return;

        setLoading(true);

        try {
            const response =
                await axiosInstance.get(
                    `/contracts/acts/${actId}/remediation`
                );

            setData(response.data);
            setError("");

        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                "Не удалось загрузить исправления"
            );

        } finally {
            setLoading(false);
        }

    }, [actId]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            if (!actId) return;

            setLoading(true);

            try {
                const response =
                    await axiosInstance.get(
                        `/contracts/acts/${actId}/remediation`
                    );

                if (!cancelled) {
                    setData(response.data);
                    setError("");
                }

            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        requestError.response?.data?.message ||
                        "Не удалось загрузить исправления"
                    );
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

    }, [actId, refreshKey]);

    if (!act) return null;

    if (
        !loading &&
        data?.status === "not_applicable"
    ) {
        return null;
    }

    const canSend =
        data?.canSubmit && !busy;

    const canReview =
        data?.canReview && !busy;

    async function submitCorrections(event) {
        event.preventDefault();

        if (
            !canSend ||
            comment.trim().length < 10
        ) {
            return;
        }

        setBusy(true);
        setError("");
        setMessage("");

        try {
            await axiosInstance.post(
                `${base}/submit`,
                {
                    comment: comment.trim(),
                    documentHash:
                    act.documentHash,
                }
            );

            setComment("");

            setMessage(
                "Информация об исправлениях сохранена. " +
                "Ожидается проверка заказчика."
            );

            await refresh();

        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                "Не удалось отправить исправления"
            );

        } finally {
            setBusy(false);
        }
    }

    async function reviewCorrections(event) {
        event.preventDefault();

        if (
            !canReview ||
            !confirmed ||
            (
                !approved &&
                comment.trim().length < 10
            )
        ) {
            return;
        }

        setBusy(true);
        setError("");
        setMessage("");

        try {
            const response =
                await axiosInstance.post(
                    `${base}/review`,
                    {
                        approved,
                        confirmed: true,
                        comment: comment.trim(),

                        documentHash:
                        act.documentHash,
                    }
                );

            setConfirmed(false);
            setComment("");

            if (approved) {
                setMessage(
                    "Исправления подтверждены. " +
                    "Создан новый проект акта."
                );

                if (onRevised) {
                    onRevised(
                        response.data.revisedAct
                    );
                }

            } else {
                setMessage(
                    "Исправления возвращены исполнителю " +
                    "на доработку."
                );
            }

            await refresh();

        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                "Не удалось сохранить проверку"
            );

        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="cc-remediation">
            <h4>Устранение замечаний</h4>

            {loading && (
                <p>Проверяем состояние исправлений…</p>
            )}

            {error && (
                <p
                    className="cc-remediation-error"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {message && (
                <p
                    className="cc-remediation-success"
                    role="status"
                >
                    {message}
                </p>
            )}

            {data &&
                data.status !== "not_applicable" && (
                    <>
                        {data.originalRemarks && (
                            <div className="cc-remediation-note">
                                <strong>
                                    Замечания заказчика
                                </strong>

                                <p>
                                    {data.originalRemarks}
                                </p>
                            </div>
                        )}

                        {data.status === "blocked" && (
                            <p className="cc-remediation-warning">
                                Доработка сейчас недоступна.
                                Возможно, по заказу открыт
                                спор или версия акта
                                больше не актуальна.
                            </p>
                        )}

                        {data.status === "revised" && (
                            <p className="cc-remediation-success">
                                Выпущен новый акт:
                                {" "}
                                {data.revisedAct?.documentNumber ||
                                    "версия 2"}.
                            </p>
                        )}

                        {data.status ===
                            "awaiting_customer" && (
                                <div className="cc-remediation-note">
                                    <strong>
                                        Исполнитель сообщил
                                        об исправлениях
                                    </strong>

                                    <p>
                                        {data.submitted?.comment}
                                    </p>
                                </div>
                            )}

                        {data.canSubmit && (
                            <form
                                onSubmit={
                                    submitCorrections
                                }
                            >
                                <label>
                                    Что было исправлено?
                                    <textarea
                                        rows={4}
                                        maxLength={1500}
                                        value={comment}
                                        disabled={busy}
                                        onChange={(event) =>
                                            setComment(
                                                event.target.value
                                            )
                                        }
                                        placeholder="Опишите выполненные исправления и результат..."
                                    />
                                </label>

                                <button
                                    type="submit"
                                    disabled={
                                        busy ||
                                        comment.trim().length < 10
                                    }
                                >
                                    {busy
                                        ? "Сохраняем..."
                                        : "Сообщить об исправлениях"}
                                </button>
                            </form>
                        )}

                        {data.canReview && (
                            <form
                                onSubmit={
                                    reviewCorrections
                                }
                            >
                                <div className="cc-remediation-options">
                                    <label>
                                        <input
                                            type="radio"
                                            checked={approved}
                                            disabled={busy}
                                            onChange={() => {
                                                setApproved(true);
                                                setConfirmed(false);
                                            }}
                                        />
                                        Исправления проверены.
                                        Выпустить новый проект акта
                                    </label>

                                    <label>
                                        <input
                                            type="radio"
                                            checked={!approved}
                                            disabled={busy}
                                            onChange={() => {
                                                setApproved(false);
                                                setConfirmed(false);
                                            }}
                                        />
                                        Исправления недостаточны.
                                        Вернуть на доработку
                                    </label>
                                </div>

                                <label>
                                    {approved
                                        ? "Комментарий (необязательно)"
                                        : "Что осталось исправить?"}

                                    <textarea
                                        rows={3}
                                        maxLength={1500}
                                        value={comment}
                                        disabled={busy}
                                        onChange={(event) =>
                                            setComment(
                                                event.target.value
                                            )
                                        }
                                    />
                                </label>

                                <label className="cc-remediation-confirm">
                                    <input
                                        type="checkbox"
                                        checked={confirmed}
                                        disabled={busy}
                                        onChange={(event) =>
                                            setConfirmed(
                                                event.target.checked
                                            )
                                        }
                                    />

                                    <span>
                                        Я проверил результат
                                        и подтверждаю выбранное
                                        действие.
                                    </span>
                                </label>

                                <button
                                    type="submit"
                                    disabled={
                                        busy ||
                                        !confirmed ||
                                        (
                                            !approved &&
                                            comment.trim().length < 10
                                        )
                                    }
                                >
                                    {busy
                                        ? "Сохраняем..."
                                        : approved
                                            ? "Подтвердить исправления"
                                            : "Вернуть на доработку"}
                                </button>
                            </form>
                        )}
                    </>
                )}
        </section>
    );
}
