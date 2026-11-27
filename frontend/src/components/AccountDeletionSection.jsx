import React, {
    useEffect,
    useRef,
    useState,
} from "react";

import {
    Trash2,
    ShieldCheck,
} from "lucide-react";

import axiosInstance from "../utils/axiosInstance";

import {
    BottomSheet,
    Button,
    SectionCard,
    SettingsRow,
    TextField,
} from "./ui";

export default function AccountDeletionSection({
                                                   embedded = false,
                                               }) {
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

    const [loading, setLoading] =
        useState(true);

    const [statusError, setStatusError] =
        useState("");

    const [error, setError] =
        useState("");

    const [attempt, setAttempt] =
        useState(0);

    const submittingRef =
        useRef(false);

    useEffect(() => {
        let active = true;

        setLoading(true);
        setStatusError("");

        axiosInstance
            .get("/account-deletion/status")
            .then(({ data }) => {
                if (!active) return;

                setRequest(
                    data?.request || null
                );
            })
            .catch(() => {
                if (!active) return;

                setStatusError(
                    "Не удалось проверить статус удаления."
                );
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [attempt]);

    const hasPendingRequest =
        ["requested", "processing"]
            .includes(request?.status);

    const openSheet = () => {
        setPassword("");
        setConfirmed(false);
        setError("");

        setOpened(true);
    };

    const closeSheet = () => {
        if (submittingRef.current) {
            return;
        }

        setOpened(false);

        setPassword("");
        setConfirmed(false);
        setError("");
    };

    const submit = async () => {
        if (
            submittingRef.current ||
            loading ||
            statusError ||
            hasPendingRequest ||
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

    const content = (
        <>

            {hasPendingRequest ? (
                <div
                    className="cc-account-deletion-status"
                    role="status"
                >
                    <ShieldCheck
                        size={24}
                        aria-hidden="true"
                    />

                    <div>

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
                </div>
            ) : (
                <SettingsRow
                    icon={<Trash2 />}
                    title="Удалить аккаунт"
                    variant="danger"
                    onClick={openSheet}
                />
            )}

            <BottomSheet
                open={opened}
                onClose={closeSheet}
                title="Удаление аккаунта"
                busy={sending}
            >
                <div className="cc-profile-sheet-stack">

                    <div className="cc-account-deletion-warning">

                        <Trash2
                            size={30}
                            aria-hidden="true"
                        />

                        <strong>
                            Запрос на удаление аккаунта
                        </strong>

                        <p>
                            Вы можете запросить удаление
                            своего аккаунта CargoCamp.
                        </p>

                        <p>
                            При обработке запроса учитываются
                            действующие заказы, обязательства,
                            споры и требования законодательства
                            к хранению документов.
                        </p>

                    </div>

                    {loading && (
                        <p role="status">
                            Проверяем статус аккаунта...
                        </p>
                    )}

                    {statusError && (
                        <>
                            <div
                                className="cc-ui-error"
                                role="alert"
                            >
                                {statusError}
                            </div>

                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={() =>
                                    setAttempt((n) => n + 1)
                                }
                            >
                                Повторить проверку
                            </Button>
                        </>
                    )}

                    {!loading &&
                        !statusError &&
                        !hasPendingRequest && (
                            <>

                                <TextField
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

                                <label className="cc-account-deletion-confirm">

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

                                {error && (
                                    <div
                                        className="cc-ui-error"
                                        role="alert"
                                    >
                                        {error}
                                    </div>
                                )}

                                <Button
                                    variant="danger"
                                    fullWidth
                                    loading={sending}
                                    disabled={
                                        !confirmed ||
                                        !password
                                    }
                                    onClick={submit}
                                >
                                    Подтвердить удаление
                                </Button>

                            </>
                        )}

                    {hasPendingRequest && (
                        <p role="status">
                            Запрос уже зарегистрирован.
                        </p>
                    )}

                    <Button
                        variant="secondary"
                        fullWidth
                        disabled={sending}
                        onClick={closeSheet}
                    >
                        Отмена
                    </Button>

                </div>
            </BottomSheet>

        </>
    );

    if (embedded) {
        return (
            <div className="cc-account-deletion-row">
                {content}
            </div>
        );
    }

    return (
        <SectionCard
            title="Управление аккаунтом"
            padded={false}
        >
            {content}
        </SectionCard>
    );
}