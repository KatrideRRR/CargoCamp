import React from "react";
import { Star, Bell, Paintbrush } from "lucide-react";

export const PROMOTION_PRICES = {
    highlight: 50,
    recommended: 100,
    push: 150,
};

export default function PromotionOptions({ value, onChange }) {
    const options = [
        {
            id: "highlight",
            label: "Выделить цветом",
            icon: <Paintbrush className="w-5 h-5 mr-2 text-yellow-500" />,
        },
        {
            id: "recommended",
            label: "Рекомендуемый заказ",
            icon: <Star className="w-5 h-5 mr-2 text-purple-500" />,
        },
        {
            id: "push",
            label: "Push-уведомление исполнителям",
            icon: <Bell className="w-5 h-5 mr-2 text-blue-500" />,
        },
    ];

    const handleToggle = (id) => {
        onChange({
            ...value,
            [id]: !value[id],
        });
    };

    return (
        <div className="bg-gray-50 p-4 rounded-xl shadow-sm mt-6">
            <h3 className="text-lg font-semibold mb-4">Продвижение заказа (необязательно)</h3>
            <div className="space-y-3">
                {options.map((opt) => (
                    <label key={opt.id} className="flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!value[opt.id]}
                            onChange={() => handleToggle(opt.id)}
                            className="mr-2 accent-primary"
                        />
                        <div className="flex items-center">
                            {opt.icon}
                            <span>
                {opt.label}{" "}
                                <span className="text-sm text-gray-500">
                  +{PROMOTION_PRICES[opt.id]} ₽
                </span>
              </span>
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}
