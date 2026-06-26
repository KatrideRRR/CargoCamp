import React, { useMemo } from "react";
import { Star, Bell, Paintbrush } from "lucide-react";

export const PROMOTION_PRICES = {
    highlight: 50,
    recommended: 100,
    push: 150,
};

export default function PromotionOptions({ value, onChange }) {
    const safeValue = {
        highlight: !!value?.highlight,
        recommended: !!value?.recommended,
        push: !!value?.push,
    };

    const options = [
        {
            id: "highlight",
            label: "Выделить цветом",
            icon: <Paintbrush className="promoIcon" />,
        },
        {
            id: "recommended",
            label: "Рекомендуемый заказ",
            icon: <Star className="promoIcon" />,
        },
        {
            id: "push",
            label: "Push-уведомление исполнителям",
            icon: <Bell className="promoIcon" />,
        },
    ];

    const total = useMemo(() => {
        return Object.entries(safeValue).reduce((sum, [key, enabled]) => {
            return enabled ? sum + PROMOTION_PRICES[key] : sum;
        }, 0);
    }, [safeValue.highlight, safeValue.recommended, safeValue.push]);

    const handleToggle = (id) => {
        onChange((prev) => {
            const current = {
                highlight: !!prev?.highlight,
                recommended: !!prev?.recommended,
                push: !!prev?.push,
            };

            return {
                ...current,
                [id]: !current[id],
            };
        });
    };

    return (
        <div className="promoOptions">
            <div className="promoOptionsHead">
                <div>
                    <div className="promoOptionsTitle">Продвижение заказа</div>
                    <div className="promoOptionsSub">Необязательно</div>
                </div>

                <div className="promoOptionsTotal">
                    {total} ₽
                </div>
            </div>

            <div className="promoOptionsList">
                {options.map((opt) => {
                    const checked = !!safeValue[opt.id];

                    return (
                        <label
                            key={opt.id}
                            className={`promoOption ${checked ? "active" : ""}`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggle(opt.id)}
                            />

                            <div className="promoOptionIcon">
                                {opt.icon}
                            </div>

                            <div className="promoOptionText">
                                <div className="promoOptionLabel">
                                    {opt.label}
                                </div>
                                <div className="promoOptionPrice">
                                    +{PROMOTION_PRICES[opt.id]} ₽
                                </div>
                            </div>

                            <div className="promoOptionCheck">
                                {checked ? "✓" : ""}
                            </div>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}