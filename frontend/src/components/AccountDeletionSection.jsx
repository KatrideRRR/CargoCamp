import React, {
    useEffect,
    useRef,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

export default function AccountDeletionSection() {
    const [opened, setOpened] =
        useState(false);

    const [password, setPassword] =
        useState("");

    const [confirmed, setConfirmed] =
        useState(false);

    const [sending, setSending] =
        useState(false);

    const [request, setRequest] =
        useState(null);

    const [error, setError] =
        useState("");

    const submittingRef =
        useRef(false);

    useEffect(() => {
        let active = true;

        axiosInstance
            .get("/account-deletion/status")
            .then(({ data }) => {
                if (active) {
                    setRequest(
                        data?.request || null
                    );
                }
            })
            .catch(() => {
                if (active) {
                    setError(
                        "Не удалось проверить статус удаления."
                    );
                }
            });

        return () => {
            active = false;
        };
    }, []);

    const submit = async () => {
        if (
            submittingRef.current ||
            !confirmed ||
            !password
        ) {
            return;
        }

        submittingRef.current = true;

        setSending(true);
        setError("");

        try {
            const { data } =
                await axiosInstance.post(
                    "/account-deletion/request",
                    {
                        password,
                        confirmed: true,
                    }
                );

            if (
                data?.success !== true ||
                data.requested !== true
            ) {
                throw new Error(
                    "Запрос не подтверждён"
                );
            }

            setRequest({
                status: "requested",
            });

            setOpened(false);
        } catch (error) {
            setError(
                error.response?.data?.message ||
                "Не удалось отправить запрос"
            );
        } finally {
            setPassword("");
            setConfirmed(false);

            submittingRef.current = false;

            setSending(false);
        }
    };

    const hasPendingRequest =
        ["requested", "processing"]
            .includes(request?.status);

    return (
        <section className="profile-card glass">

            <h2 className="card-title">
                Управление аккаунтом
            </h2>

            {hasPendingRequest ? (
                <div role="status">
                    <strong>
                        Запрос на удаление зарегистрирован
                    </strong>

                    <p>
                        Ваш запрос будет рассмотрен.
                        Необходимые документы могут
                        сохраняться при наличии
                        законных оснований.
                    </p>
                </div>
            ) : (
                <button
                    type="button"
                    className="btn btn-ghost-danger"
                    onClick={() => {
                        setOpened(true);
                        setError("");
                    }}
                >
                    Удалить аккаунт
                </button>
            )}

            {opened && (
                <div className="account-deletion-form">

                    <p>
                        Вы можете запросить удаление
                        своего аккаунта CargoCamp.
                    </p>

                    <p>
                        При обработке запроса
                        учитываются действующие заказы,
                        обязательства, споры и требования
                        законодательства к хранению
                        документов.
                    </p>

                    <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Пароль аккаунта"
                        aria-label="Пароль аккаунта"
                        value={password}
                        disabled={sending}
                        onChange={(event) =>
                            setPassword(
                                event.target.value
                            )
                        }
                    />

                    <label className="cc-identity-confirm">

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
                            Я подтверждаю запрос
                            на удаление аккаунта.
                        </span>
                    </label>

                    <button
                        type="button"
                        className="btn btn-danger"
                        disabled={
                            sending ||
                            !confirmed ||
                            !password
                        }
                        onClick={submit}
                    >
                        {sending
                            ? "Отправляем..."
                            : "Подтвердить удаление"}
                    </button>

                    <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={sending}
                        onClick={() => {
                            setOpened(false);
                            setPassword("");
                            setConfirmed(false);
                            setError("");
                        }}
                    >
                        Отмена
                    </button>
                </div>
            )}

            {error && (
                <p role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}