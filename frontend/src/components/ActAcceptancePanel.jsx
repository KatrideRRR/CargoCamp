
import React, {
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import "../styles/ActAcceptancePanel.css";

const ACTIVE_DISPUTE_STATUSES = new Set([
    "open",
    "in_review",
    "waiting_creator",
    "waiting_executor",
]);

const OPTIONS = [

    {
        value: "accepted",
        label: "Работы приняты без замечаний",
    },
    {
        value: "remarks",
        label: "Работы завершены, есть замечания",
    },
    {
        value: "dispute",
        label: "Не согласен с результатом — открыть спор",
    },
];


function labelForDecision(value) {
    return OPTIONS.find(
        (option) => option.value === value
    )?.label || "Решение сохранено";
}

export default function ActAcceptancePanel({ act, onDecisionSaved,}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [selection, setSelection] =
        useState("accepted");

    const [comment, setComment] = useState("");
    const [confirmed, setConfirmed] =
        useState(false);

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const actId = act?.id;

    useEffect(() => {
        if (!actId) return;

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError("");

            try {
                const response =
                    await axiosInstance.get(
                        `/contracts/acts/${actId}/acceptance`
                    );

                if (!cancelled) {
                    setData(response.data);
                }

            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        requestError.response?.data?.message ||
                        "Не удалось загрузить приёмку"
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

    }, [actId]);

    if (!act) return null;

    const existing = data?.decision || null;

    const needsComment =
        selection === "remarks" ||
        selection === "dispute";

    async function resolveDisputeId() {
        const url =
            `/disputes/order/regular/${act.orderId}`;

        const current =
            await axiosInstance.get(url);

        const existingDispute =
            current.data?.dispute;

        if (
            existingDispute &&
            ACTIVE_DISPUTE_STATUSES.has(
                existingDispute.status
            )
        ) {
            return Number(existingDispute.id);
        }

        /*
         * Используем существующий API споров.
         * Он уведомляет вторую сторону
         * и администраторов CargoCamp.
         */
        try {
            const response =
                await axiosInstance.post(
                    "/disputes/open",
                    {
                        orderId: act.orderId,
                        orderType: "regular",

                        reasonCode:
                            "service_problem",

                        reason:
                            "Не согласен с результатом выполнения заказа",

                        description:
                            comment.trim(),
                    }
                );

            const id =
                Number(response.data?.dispute?.id);

            if (
                !Number.isSafeInteger(id) ||
                id <= 0
            ) {
                throw new Error(
                    "Спор создан, но не удалось получить его ID"
                );
            }

            return id;

        } catch (requestError) {
            /*
             * Если параллельно появился спор,
             * повторно читаем его состояние.
             */
            if (
                requestError.response?.status === 400
            ) {
                const retry =
                    await axiosInstance.get(url);

                const dispute =
                    retry.data?.dispute;

                if (
                    dispute &&
                    ACTIVE_DISPUTE_STATUSES.has(
                        dispute.status
                    )
                ) {
                    return Number(dispute.id);
                }
            }

            throw requestError;
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (
            saving ||
            !data?.canDecide ||
            !confirmed
        ) {
            return;
        }

        const text = comment.trim();

        if (
            needsComment &&
            (
                text.length < 10 ||
                text.length > 1500
            )
        ) {
            setError(
                "Описание должно содержать от 10 до 1500 символов"
            );
            return;
        }

        try {
            setSaving(true);
            setError("");
            setSuccess("");

            let disputeId = null;

            if (selection === "dispute") {
                disputeId =
                    await resolveDisputeId();
            }

            const response =
                await axiosInstance.post(
                    `/contracts/acts/${actId}/acceptance`,
                    {
                        decision: selection,

                        comment:
                            selection === "accepted"
                                ? ""
                                : text,

                        disputeId,

                        documentHash:
                        act.documentHash,
                    }
                );

            if (!response.data?.success) {
                throw new Error(
                    "Сервер не подтвердил сохранение"
                );
            }

            setData((previous) => ({
                ...previous,

                decision:
                response.data.decision,

                canDecide: false,

                hasActiveDispute:
                    previous.hasActiveDispute ||
                    selection === "dispute",
            }));

            setConfirmed(false);

            setSuccess(
                "Ваше решение сохранено в истории акта."
            );

            if (onDecisionSaved) {
                onDecisionSaved();
            }

        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                requestError.message ||
                "Не удалось сохранить решение"
            );

        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="cc-act-acceptance">
            <h4>Приёмка выполненных работ</h4>

            {loading && (
                <p>Проверяем статус приёмки…</p>
            )}

            {error && (
                <p
                    className="cc-act-acceptance-error"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {success && (
                <p
                    className="cc-act-acceptance-success"
                    role="status"
                >
                    {success}
                </p>
            )}

            {!loading && existing && (
                <div className="cc-act-acceptance-result">
                    <strong>
                        {labelForDecision(
                            existing.decision
                        )}
                    </strong>

                    {existing.comment && (
                        <p>
                            {existing.comment}
                        </p>
                    )}

                    {existing.disputeId && (
                        <small>
                            Спор №{existing.disputeId}
                        </small>
                    )}

                    <small>
                        Решение сохранено.
                        Изменение потребует
                        отдельного оформления.
                    </small>
                </div>
            )}

            {!loading &&
                data &&
                !existing &&
                !data.isCustomer && (
                    <p className="cc-act-acceptance-note">
                        Решение о приёмке принимает
                        заказчик. Вы сможете увидеть
                        его здесь после сохранения.
                    </p>
                )}

            {!loading &&
                data?.isCustomer &&
                !existing &&
                !data.canDecide && (
                    <p className="cc-act-acceptance-note">
                        Приёмка этого акта
                        сейчас недоступна.
                    </p>
                )}

            {!loading &&
                data?.canDecide &&
                !existing && (
                    <form onSubmit={handleSubmit}>
                        <p className="cc-act-acceptance-note">
                            Выберите результат.
                            Это отдельное решение,
                            а не электронная подпись PDF.
                        </p>

                        <div className="cc-act-options">
                            {OPTIONS.filter(
                                (option) =>
                                    option.value !== "remarks" ||
                                    data?.canRequestCorrections
                            ).map((option) => (
                                <label
                                    key={option.value}
                                    className="cc-act-option"
                                >
                                    <input
                                        type="radio"
                                        name={`act-${actId}`}
                                        value={option.value}
                                        checked={
                                            selection === option.value
                                        }
                                        disabled={saving}
                                        onChange={() => {
                                            setSelection(option.value);
                                            setConfirmed(false);
                                        }}
                                    />

                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </div>

                        {needsComment && (
                            <label className="cc-act-comment">
                                <span>
                                    {selection === "remarks"
                                        ? "Опишите замечания"
                                        : "Опишите причину спора"}
                                </span>

                                <textarea
                                    rows={4}
                                    value={comment}
                                    maxLength={1500}
                                    disabled={saving}
                                    onChange={(event) =>
                                        setComment(
                                            event.target.value
                                        )
                                    }
                                    placeholder="Что именно не устроило в выполненной работе?"
                                />
                                <small>
                                    {comment.length} / 1500
                                </small>
                            </label>
                        )}

                        {selection === "accepted" &&
                            data.hasActiveDispute && (
                                <p className="cc-act-acceptance-error">
                                    По заказу открыт спор.
                                    Приёмка без замечаний
                                    будет отклонена сервером.
                                </p>
                            )}

                        <label className="cc-act-confirm">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                disabled={saving}
                                onChange={(event) =>
                                    setConfirmed(
                                        event.target.checked
                                    )
                                }
                            />

                            <span>
                                Я подтверждаю выбранное
                                решение и понимаю, что
                                оно будет сохранено
                                в истории акта.
                            </span>
                        </label>

                        <button
                            type="submit"
                            disabled={
                                saving ||
                                !confirmed ||
                                (
                                    selection === "accepted" &&
                                    data.hasActiveDispute
                                )
                            }
                        >
                            {saving
                                ? "Сохраняем…"
                                : selection === "dispute"
                                    ? "Открыть спор и сохранить решение"
                                    : "Сохранить решение"}
                        </button>
                    </form>
                )}
        </section>
    );
}
