
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { useAuth } from "../utils/authContext";
import PublicOffer, {
    PUBLIC_OFFER_VERSION,
} from "./PublicOffer";
import "../styles/PublicOfferGate.css";

const initialStatus = {
    userId: null,
    phase: "idle",
    version: null,
    sha256: null,
    message: "",
};

export default function PublicOfferGate({ children }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const userId =
        user?.id == null ? null : String(user.id);

    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState(initialStatus);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let active = true;

        setChecked(false);

        if (!userId) {
            setStatus(initialStatus);
            return () => {
                active = false;
            };
        }

        setStatus({
            userId,
            phase: "loading",
            version: null,
            sha256: null,
            message: "",
        });

        const checkOffer = async () => {
            try {
                const { data } = await axiosInstance.get(
                    "/legal/offer/status"
                );

                if (!active) return;

                if (
                    !data?.version ||
                    !data?.sha256 ||
                    data.version !== PUBLIC_OFFER_VERSION
                ) {
                    setStatus({
                        userId,
                        phase: "error",
                        version: null,
                        sha256: null,
                        message:
                            "Редакция оферты на сервере отличается от версии приложения. Обновите CargoCamp.",
                    });

                    return;
                }

                setStatus({
                    userId,
                    phase: data.accepted
                        ? "accepted"
                        : "required",
                    version: data.version,
                    sha256: data.sha256,
                    message: "",
                });
            } catch (error) {
                if (!active) return;

                setStatus({
                    userId,
                    phase: "error",
                    version: null,
                    sha256: null,
                    message:
                        "Не удалось проверить принятие оферты. Проверьте соединение и повторите.",
                });
            }
        };

        checkOffer();

        return () => {
            active = false;
        };
    }, [userId, attempt]);

    // Состояние относится только к текущему пользователю.
    // Результат проверки другой сессии не используется.
    const currentPhase =
        !userId
            ? "idle"
            : status.userId === userId
                ? status.phase
                : "loading";

    const canUseApp =
        !userId || currentPhase === "accepted";

    const showDialog = Boolean(userId) && !canUseApp;

    const acceptOffer = async () => {
        if (
            !checked ||
            currentPhase !== "required" ||
            !status.sha256
        ) {
            return;
        }

        setStatus((previous) => ({
            ...previous,
            phase: "submitting",
            message: "",
        }));

        try {
            const { data } = await axiosInstance.post(
                "/legal/offer/accept",
                {
                    version: status.version,
                    sha256: status.sha256,
                    confirmed: true,
                }
            );

            if (
                data?.accepted !== true ||
                data.version !== PUBLIC_OFFER_VERSION
            ) {
                throw new Error(
                    "Сервер не подтвердил принятие оферты"
                );
            }

            setStatus((previous) => ({
                ...previous,
                userId,
                phase: "accepted",
                message: "",
            }));
        } catch (error) {
            setStatus((previous) => ({
                ...previous,
                userId,
                phase: "required",
                message:
                    error.response?.data?.message ||
                    error.message ||
                    "Не удалось сохранить согласие",
            }));
        }
    };

    const exitAccount = async () => {
        try {
            await logout();
        } finally {
            navigate("/login", {
                replace: true,
            });
        }
    };

    return (
        <>
            {canUseApp ? children : null}

            {showDialog && (
                <div className="cc-offer-gate-overlay">
                    <div
                        className="cc-offer-gate-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cc-offer-gate-title"
                    >
                        <h2 id="cc-offer-gate-title">
                            Принятие публичной оферты
                        </h2>

                        {currentPhase === "loading" ||
                        currentPhase === "idle" ? (
                            <p role="status">
                                Проверяем принятие публичной
                                оферты...
                            </p>
                        ) : currentPhase === "error" ? (
                            <>
                                <p role="alert">
                                    {status.message}
                                </p>

                                <button
                                    type="button"
                                    onClick={() =>
                                        setAttempt((n) => n + 1)
                                    }
                                >
                                    Повторить проверку
                                </button>
                            </>
                        ) : (
                            <>
                                <p>
                                    Пожалуйста, ознакомьтесь
                                    с действующей редакцией
                                    оферты CargoCamp.
                                </p>

                                <div className="cc-offer-gate-document">
                                    <PublicOffer />
                                </div>

                                <label className="cc-offer-gate-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={
                                            currentPhase ===
                                            "submitting"
                                        }
                                        onChange={(event) =>
                                            setChecked(
                                                event.target.checked
                                            )
                                        }
                                    />
                                    <span>
                                        Я ознакомился с публичной
                                        офертой и принимаю её условия
                                    </span>
                                </label>

                                {status.message && (
                                    <p role="alert">
                                        {status.message}
                                    </p>
                                )}

                                <button
                                    type="button"
                                    className="cc-offer-gate-accept"
                                    disabled={
                                        !checked ||
                                        currentPhase !== "required"
                                    }
                                    onClick={acceptOffer}
                                >
                                    {currentPhase === "submitting"
                                        ? "Сохраняем..."
                                        : "Принять оферту"}
                                </button>
                            </>
                        )}

                        <button
                            type="button"
                            className="cc-offer-gate-exit"
                            onClick={exitAccount}
                        >
                            Выйти из аккаунта
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
