import React, {useEffect, useState,
} from "react";
import "../styles/ContractSigningPanel.css";
import axiosInstance from "../utils/axiosInstance";

export default function ContractSigningPanel({
                                                 assignment,
                                                 onSigned,
                                             }) {
    const [opened, setOpened] = useState(false);
    const [state, setState] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [code, setCode] = useState("");

    const isAct =
        assignment.type ===
        "verified_completion_act";

    const documentTitle = isAct
        ? "акта"
        : "договора";

    const base =
        `/contracts/signing/${assignment.id}`;

    const refresh = async () => {
        try {
            setLoading(true);
            setError("");

            const response = await axiosInstance.get(
                `${base}/status`
            );

            setState(response.data);
        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось получить статус подписания"
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (opened) refresh();
        // При открытии и смене договора.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opened, assignment.id]);

    const requestCode = async () => {
        if (!confirmed || busy) return;

        try {
            setBusy(true);
            setError("");
            setMessage("");


            if (state?.signingMethod === "click") {
                const response = await axiosInstance.post(
                    `${base}/click-sign`,
                    {
                        documentHash: assignment.documentHash,
                        intentConfirmed: true,
                    }
                );

                setConfirmed(false);

                setMessage(
                    response.data.fullySigned
                        ? "Документ подписан обеими сторонами."
                        : "Подпись сохранена. Ожидается вторая сторона."
                );

                await refresh();

                if (onSigned) {
                    onSigned();
                }

                return;
            }

            const response = await axiosInstance.post(
                `${base}/request-code`,
                {
                    documentHash: assignment.documentHash,
                    intentConfirmed: true,
                }
            );

            setState((prev) => ({
                ...prev,
                pendingChallenge: {
                    id: response.data.challengeId,
                    maskedPhone:
                    response.data.maskedPhone,
                },
            }));

            setMessage(
                "SMS-код отправлен. Он действует 5 минут."
            );

        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось отправить SMS"
            );

        } finally {
            setBusy(false);
        }
    };

    const confirmCode = async () => {
        if (!/^\d{6}$/.test(code) || busy) {
            return;
        }

        try {
            setBusy(true);
            setError("");
            setMessage("");

            const response = await axiosInstance.post(
                `${base}/confirm-code`,
                {
                    challengeId:
                    state.pendingChallenge.id,
                    documentHash:
                    assignment.documentHash,
                    code,
                }
            );

            setCode("");
            setConfirmed(false);

            setMessage(
                response.data.fullySigned
                    ? "Договор подписан обеими сторонами."
                    : "Ваша подпись сохранена. Ожидается вторая сторона."
            );

            await refresh();

            if (onSigned) {
                onSigned();
            }

        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось подтвердить код"
            );

        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="cc-signing">
            <button
                type="button"
                className="cc-signing-toggle"
                aria-expanded={opened}
                onClick={() => setOpened(!opened)}
            >
                <span>
                    <strong>✍️ Подписание договора</strong>
<small>
    {state?.signingMethod === "click"
        ? "Подписание без повторной SMS"
        : "Первое подтверждение — SMS"}
</small>
                </span>

                <span aria-hidden="true">
                    {opened ? "⌄" : "›"}
                </span>
            </button>

            {opened && (
                <div className="cc-signing-content">
                    {loading && <p>Проверяем статус…</p>}

                    {error && (
                        <p className="cc-signing-error" role="alert">
                            {error}
                        </p>
                    )}

                    {message && (
                        <p className="cc-signing-success" role="status">
                            {message}
                        </p>
                    )}

                    {state && !loading && (
                        <>
                            {state.mySigned && (
                                <p className="cc-signing-success">
                                    Вы уже подтвердили этот документ.
                                    {state.otherSigned
                                        ? " Обе стороны подписали договор."
                                        : " Ожидается подпись второй стороны."}
                                </p>
                            )}

                            {!state.enabled && !state.mySigned && (
                                <p className="cc-signing-note">
                                    SMS-подписание находится
                                    на этапе подготовки.
                                    Сейчас документы можно
                                    просматривать, но не подписывать.
                                </p>
                            )}

                            {state.enabled &&
                                !state.accepted && (
                                    <p className="cc-signing-note">
                                        Сначала примите соглашение
                                        об электронной подписи
                                        в разделе выше.
                                    </p>
                                )}

                            {state.canSign && (
                                <>
                                    <p className="cc-signing-note">
                                        Договор:{" "}
                                        {assignment.documentNumber}
                                        {" · "}
                                        Версия {assignment.version}.
                                        {state.signingMethod === "click"
                                            ? "Подписание доступно с подтверждённой ПЭП."
                                            : `Код будет отправлен на ${state.maskedPhone}.`}
                                    </p>

                                    {(state.signingMethod === "click" ||
                                        !state.pendingChallenge) && (
                                            <>
                                            <label className="cc-signing-consent">
                                                <input
                                                    type="checkbox"
                                                    checked={confirmed}
                                                    onChange={(e) =>
                                                        setConfirmed(
                                                            e.target.checked
                                                        )
                                                    }
                                                />
                                                <span>
                                                    Я ознакомился с PDF
                                                    указанной версии и
                                                    намерен подписать
                                                    именно этот документ.
                                                </span>

                                                {state.blockedReason &&
                                                    !state.mySigned && (
                                                        <p className="cc-signing-note">
                                                            {state.blockedReason}
                                                        </p>
                                                    )}
                                            </label>

                                            <button
                                                type="button"
                                                disabled={!confirmed || busy}
                                                onClick={requestCode}
                                            >
                                                {busy
                                                    ? "Подписываем…"
                                                    : state.signingMethod === "click"
                                                        ? "Подписать документ"
                                                        : "Отправить SMS-код"}                                            </button>
                                        </>
                                    )}

                                    {state.signingMethod === "sms" &&
                                        state.pendingChallenge && (
                                            <>
                                            <label className="cc-signing-code-label">
                                                Код из SMS
                                                <input
                                                    inputMode="numeric"
                                                    autoComplete="one-time-code"
                                                    maxLength={6}
                                                    value={code}
                                                    placeholder="000000"
                                                    onChange={(e) =>
                                                        setCode(
                                                            e.target.value
                                                                .replace(/\D/g, "")
                                                                .slice(0, 6)
                                                        )
                                                    }
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                disabled={
                                                    busy ||
                                                    code.length !== 6
                                                }
                                                onClick={confirmCode}
                                            >
                                                {busy
                                                    ? "Проверяем..."
                                                    : "Подписать договор"}
                                            </button>
                                        </>
                                    )}
                                </>
                            )}

                            {state.signingMethod === "reauth" &&
                                !state.mySigned && (
                                    <p className="cc-signing-note">
                                        Первичная SMS-проверка ПЭП действует,
                                        но для подписания требуется повторный вход
                                        в аккаунт CargoCamp.
                                    </p>
                                )}

                            <button
                                type="button"
                                className="cc-signing-refresh"
                                disabled={busy || loading}
                                onClick={refresh}
                            >
                                Обновить статус
                            </button>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
