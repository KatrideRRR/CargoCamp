
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { useAuth } from "../utils/authContext";
import PublicOffer, {
    PUBLIC_OFFER_VERSION,
} from "./PublicOffer";
import "../styles/PublicOfferGate.css";

export default function PublicOfferGate({ children }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState({
        phase: "loading",
        version: null,
        sha256: null,
        message: "",
    });

    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let active = true;

        if (!user?.id) {
            setStatus({
                phase: "idle",
                version: null,
                sha256: null,
                message: "",
            });
            setChecked(false);
            return;
        }

        setStatus({
            phase: "loading",
            version: null,
            sha256: null,
            message: "",
        });

        setChecked(false);

        axiosInstance
            .get("/legal/offer/status")
            .then(({ data }) => {
                if (!active) return;

                if (
                    !data?.version ||
                    !data?.sha256 ||
                    data.version !== PUBLIC_OFFER_VERSION
                ) {
                    setStatus({
                        phase: "error",
                        version: null,
                        sha256: null,
                        message:
                            "Редакция оферты на сервере отличается от версии приложения. Обновите CargoCamp.",
                    });

                    return;
                }

                setStatus({
                    phase: data.accepted
                        ? "accepted"
                        : "required",
                    version: data.version,
                    sha256: data.sha256,
                    message: "",
                });
            })
            .catch(() => {
                if (!active) return;

                setStatus({
                    phase: "error",
                    version: null,
                    sha256: null,
                    message:
                        "Не удалось проверить принятие оферты. Проверьте соединение и повторите.",
                });
            });

        return () => {
            active = false;
        };
    }, [user?.id, attempt]);

    const acceptOffer = async () => {
        if (
            !checked ||
            status.phase !== "required"
        ) {
            return;
        }

        setStatus((prev) => ({
            ...prev,
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
                data?.version !== PUBLIC_OFFER_VERSION
            ) {
                throw new Error(
                    "Сервер не подтвердил сохранение согласия"
                );
            }

            setStatus((prev) => ({
                ...prev,
                phase: "accepted",
                message: "",
            }));
        } catch (error) {
            setStatus((prev) => ({
                ...prev,
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
            navigate("/login", { replace: true });
        }
    };

    const showDialog =
        Boolean(user?.id) &&
        ["required", "submitting", "error"].includes(
            status.phase
        );

    return (
        <>
            {children}

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

                        {status.phase === "error" ? (
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
                                            status.phase === "submitting"
                                        }
                                        onChange={(e) =>
                                            setChecked(
                                                e.target.checked
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
                                        status.phase === "submitting"
                                    }
                                    onClick={acceptOffer}
                                >
                                    {status.phase === "submitting"
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
