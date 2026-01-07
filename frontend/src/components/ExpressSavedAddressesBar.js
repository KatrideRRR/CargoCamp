import React, { useMemo, useState } from "react";
import "../styles/ExpressSavedAddressesBar.css";

const labelTitle = (l) => {
    if (l === "home") return "Дом";
    if (l === "work") return "Работа";
    return "Адрес";
};

const ExpressSavedAddressesBar = ({ items = [], onPickFrom, onPickTo }) => {
    const [smartMode, setSmartMode] = useState(true); // true: A потом B
    const [nextPoint, setNextPoint] = useState("from"); // from|to

    const top = useMemo(() => items.slice(0, 8), [items]);

    if (!top.length) return null;

    return (
        <div className="exo-sa">
            <div className="exo-saHead">
                <div>
                    <div className="exo-saTitle">Частые адреса</div>
                    <div className="exo-saSub">Нажми — подставим точки A/B</div>
                </div>

                <button className={`exo-saToggle ${smartMode ? "on" : ""}`} type="button" onClick={() => setSmartMode((p) => !p)}>
                    {smartMode ? "Умно: A→B" : "Ручной выбор"}
                </button>
            </div>

            <div className="exo-saGrid">
                {top.map((s) => (
                    <div key={s.id} className="exo-saItem">
                        <button
                            type="button"
                            className="exo-saChip"
                            onClick={() => {
                                if (smartMode) {
                                    if (nextPoint === "from") {
                                        onPickFrom?.(s);
                                        setNextPoint("to");
                                    } else {
                                        onPickTo?.(s);
                                        setNextPoint("from");
                                    }
                                } else {
                                    onPickFrom?.(s);
                                }
                            }}
                            title={s.address}
                        >
                            <span className="exo-saTag">{labelTitle(s.label)}</span>
                            <span className="exo-saText">{s.title || s.address}</span>
                        </button>

                        {!smartMode && (
                            <div className="exo-saBtns">
                                <button type="button" className="exo-saMini" onClick={() => onPickFrom?.(s)}>
                                    В “Откуда”
                                </button>
                                <button type="button" className="exo-saMini" onClick={() => onPickTo?.(s)}>
                                    В “Куда”
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {smartMode && (
                <div className="exo-saHint">
                    💡 Следующий клик заполнит: <b>{nextPoint === "from" ? "Откуда (A)" : "Куда (B)"}</b>
                </div>
            )}
        </div>
    );
};

export default ExpressSavedAddressesBar;