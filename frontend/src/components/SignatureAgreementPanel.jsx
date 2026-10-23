
import React, {
    useEffect,
    useState,
} from "react";

import axiosInstance
    from "../utils/axiosInstance";

import "../styles/SignatureAgreementPanel.css";

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleString("ru-RU");
}

export default function SignatureAgreementPanel() {
    const [opened, setOpened] = useState(false);

    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);

    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false);

    const [historyOpen, setHistoryOpen] =
        useState(false);

    const [historyLoading, setHistoryLoading] =
        useState(false);

    const [historyError, setHistoryError] =
        useState("");

    const [history, setHistory] =
        useState([]);

    useEffect(() => {
        if (!opened) return;

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError("");

            try {
                const response =
                    await axiosInstance.get(
                        "/contracts/e-sign/agreement"
                    );

                if (
                    !cancelled &&
                    response.data?.success
                ) {
                    setData(response.data);
                }

            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        requestError.response
                            ?.data?.message ||
                        "Не удалось загрузить соглашение"
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

    }, [opened]);

    const handleAccept = async () => {
        if (
            !data?.canAccept ||
            !confirmed ||
            sending
        ) {
            return;
        }

        try {
            setSending(true);
            setError("");

            const response =
                await axiosInstance.post(
                    "/contracts/e-sign/agreement",
                    {
                        accepted: true,

                        policySha256:
                        data.policy.sha256,
                    }
                );

            if (!response.data?.success) {
                throw new Error(
                    "Сервер не подтвердил принятие"
                );
            }

            setData((previous) => ({
                ...previous,

                accepted: true,
                canAccept: false,

                agreement:
                response.data.agreement,
            }));

            setConfirmed(false);

        } catch (requestError) {
            setError(
                requestError.response
                    ?.data?.message ||
                requestError.message ||
                "Не удалось сохранить соглашение"
            );

        } finally {
            setSending(false);
        }
    };


    const toggleHistory = async () => {
        if (historyOpen) {
            setHistoryOpen(false);
            return;
        }

        setHistoryOpen(true);
        setHistoryLoading(true);
        setHistoryError("");

        try {
            const response =
                await axiosInstance.get(
                    "/contracts/e-sign/my-agreements"
                );

            setHistory(
                Array.isArray(
                    response.data?.agreements
                )
                    ? response.data.agreements
                    : []
            );

        } catch (error) {
            setHistoryError(
                error.response?.data?.message ||
                "Не удалось загрузить архив соглашений"
            );

        } finally {
            setHistoryLoading(false);
        }
    };


    return (
        <div className="cc-signature-agreement">
            <button
                type="button"
                className="cc-sa-toggle"
                aria-expanded={opened}
                onClick={() =>
                    setOpened((current) => !current)
                }
            >
                <span>
                    <strong>
                        ✍️ Электронное подписание
                    </strong>

                    <small>
                        Правила использования
                        электронной подписи
                    </small>
                </span>

                <span
                    className={
                        `cc-sa-chevron ${
                            opened ? "open" : ""
                        }`
                    }
                    aria-hidden="true"
                >
                    ›
                </span>
            </button>

            {opened && (
                <div className="cc-sa-content">
                    {loading && (
                        <p>Загружаем соглашение…</p>
                    )}

                    {error && (
                        <p
                            className="cc-sa-error"
                            role="alert"
                        >
                            {error}
                        </p>
                    )}

                    {data && !loading && (
                        <>
                            {data.accepted ? (
                                <div
                                    className="cc-sa-success"
                                    role="status"
                                >
                                    <strong>
                                        Соглашение принято
                                    </strong>

                                    <span>
                                        Дата:{" "}
                                        {formatDate(
                                            data.agreement
                                                ?.acceptedAt
                                        )}
                                    </span>
                                </div>
                            ) : (
                                <p className="cc-sa-intro">
                                    До подписания договоров
                                    необходимо ознакомиться
                                    с правилами электронной
                                    подписи.
                                </p>
                            )}

                            <div className="cc-sa-policy-meta">
                                Редакция{" "}
                                {data.policy.version}
                            </div>

                            <div className="cc-sa-policy-text">
                                {data.policy.text}
                            </div>


                            <div className="cc-sa-history">
                                <button
                                    type="button"
                                    onClick={toggleHistory}
                                    aria-expanded={historyOpen}
                                >
                                    {historyOpen
                                        ? "Скрыть принятые редакции"
                                        : "Мои принятые редакции"}
                                </button>

                                {historyOpen && (
                                    <div>
                                        {historyLoading && (
                                            <p>Загружаем архив…</p>
                                        )}

                                        {historyError && (
                                            <p role="alert">
                                                {historyError}
                                            </p>
                                        )}

                                        {!historyLoading &&
                                            !historyError &&
                                            history.length === 0 && (
                                                <p>
                                                    Вы ещё не принимали
                                                    правила электронной подписи.
                                                </p>
                                            )}

                                        {history.map((item) => (
                                            <details key={item.id}>
                                                <summary>
                                                    Редакция {item.version}
                                                    {" · "}
                                                    {formatDate(item.acceptedAt)}
                                                </summary>

                                                <p>
                                                    SHA-256: {item.sha256}
                                                </p>

                                                {item.archiveVerified ? (
                                                    <div
                                                        className="cc-sa-policy-text"
                                                        style={{
                                                            whiteSpace: "pre-wrap",
                                                        }}
                                                    >
                                                        {item.policyText}
                                                    </div>
                                                ) : (
                                                    <p role="alert">
                                                        Архивная редакция
                                                        не прошла проверку
                                                        целостности.
                                                    </p>
                                                )}
                                            </details>
                                        ))}
                                    </div>
                                )}
                            </div>


                            {!data.policy.enabled && (
                                <p className="cc-sa-notice">
                                    Правила находятся на
                                    подготовительном этапе.
                                    Принятие соглашений
                                    пока отключено.
                                </p>
                            )}

                            {data.policy.enabled &&
                                !data.identityVerified && (
                                    <p className="cc-sa-notice">
                                        Для принятия соглашения
                                        требуется действующее
                                        подтверждение личности.
                                    </p>
                                )}

                            {data.canAccept && (
                                <div className="cc-sa-accept">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={confirmed}
                                            disabled={sending}
                                            onChange={(event) =>
                                                setConfirmed(
                                                    event.target.checked
                                                )
                                            }
                                        />

                                        <span>
                                            Я ознакомился с
                                            указанной редакцией
                                            правил и согласен
                                            использовать
                                            электронную подпись
                                            в рамках CargoCamp.
                                        </span>
                                    </label>

                                    <button
                                        type="button"
                                        disabled={
                                            !confirmed ||
                                            sending
                                        }
                                        onClick={handleAccept}
                                    >
                                        {sending
                                            ? "Сохраняем…"
                                            : "Принять соглашение"}
                                    </button>
                                </div>
                            )}

                            <p className="cc-sa-footer">
                                Принятие правил не
                                подписывает этот договор.
                                Подтверждение конкретного
                                PDF выполняется отдельно.
                            </p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
