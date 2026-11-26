import React, {
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

export default function PersonalDataConsent({
                                                code,
                                                disabled = false,
                                                onChange,
                                            }) {
    const [document, setDocument] =
        useState(null);

    const [checked, setChecked] =
        useState(false);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [attempt, setAttempt] =
        useState(0);

    useEffect(() => {
        let active = true;

        setDocument(null);
        setChecked(false);
        setLoading(true);
        setError("");
        onChange(null);

        const load = async () => {
            try {
                const { data } =
                    await axiosInstance.get(
                        `/legal/consents/${encodeURIComponent(code)}`
                    );

                if (!active) return;

                const received =
                    data?.document;

                if (
                    !received?.version ||
                    !received?.sha256 ||
                    !received?.text ||
                    received.code !== code
                ) {
                    throw new Error(
                        "Не удалось получить документ"
                    );
                }

                setDocument(received);
            } catch (error) {
                if (!active) return;

                setError(
                    "Не удалось загрузить согласие"
                );
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void load();

        return () => {
            active = false;
        };
    }, [code, attempt, onChange]);

    if (loading) {
        return (
            <p role="status">
                Загружаем документ согласия...
            </p>
        );
    }

    if (error) {
        return (
            <div role="alert">
                <p>{error}</p>

                <button
                    type="button"
                    onClick={() =>
                        setAttempt(
                            (value) => value + 1
                        )
                    }
                >
                    Повторить
                </button>
            </div>
        );
    }

    if (!document) return null;

    return (
        <div className="cc-personal-data-consent">

            <details>
                <summary>
                    Согласие на обработку
                    персональных данных
                </summary>

                <div
                    style={{
                        whiteSpace: "pre-wrap",
                        padding: "12px 0",
                    }}
                >
                    {document.text}
                </div>

                <small>
                    Редакция: {document.version}
                </small>
            </details>

            <label className="cc-identity-confirm">

                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => {
                        const value =
                            event.target.checked;

                        setChecked(value);

                        onChange(
                            value
                                ? {
                                    version:
                                    document.version,

                                    sha256:
                                    document.sha256,

                                    confirmed: true,
                                }
                                : null
                        );
                    }}
                />

                <span>
                    Я ознакомился с отдельным
                    согласием на обработку
                    персональных данных и
                    добровольно принимаю его.
                </span>
            </label>
        </div>
    );
}