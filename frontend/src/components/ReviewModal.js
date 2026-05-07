import React, { useMemo, useState } from "react";
import "../styles/ReviewModal.css";

export default function ReviewModal({
                                        isOpen,
                                        onClose,
                                        onSubmit,
                                        title = "Оставить отзыв",
                                        subtitle = "Оцените участника и при желании добавьте комментарий",
                                        loading = false,
                                    }) {
    const [rating, setRating] = useState(0);
    const [text, setText] = useState("");

    const canSubmit = useMemo(() => rating >= 1 && rating <= 5 && !loading, [rating, loading]);

    const handleClose = () => {
        if (loading) return;
        setRating(0);
        setText("");
        onClose?.();
    };

    const handleSubmit = async () => {
        if (!canSubmit) return;

        const success = await onSubmit?.({
            rating,
            text: text.trim(),
        });

        if (success) {
            setRating(0);
            setText("");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="reviewModalOverlay" onClick={handleClose}>
            <div className="reviewModal" onClick={(e) => e.stopPropagation()}>
                <div className="reviewModalHeader">
                    <div>
                        <h2 className="reviewModalTitle">{title}</h2>
                        <p className="reviewModalSubtitle">{subtitle}</p>
                    </div>

                    <button className="reviewModalClose" onClick={handleClose} aria-label="Закрыть">
                        ✕
                    </button>
                </div>

                <div className="reviewStars">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            type="button"
                            className={`reviewStar ${star <= rating ? "active" : ""}`}
                            onClick={() => setRating(star)}
                            aria-label={`Поставить ${star}`}
                        >
                            ★
                        </button>
                    ))}
                </div>

                <textarea
                    className="reviewTextarea"
                    placeholder="Комментарий (необязательно)"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    maxLength={800}
                />

                <div className="reviewActions">
                    <button className="reviewBtn ghost" onClick={handleClose} disabled={loading}>
                        Позже
                    </button>

                    <button className="reviewBtn primary" onClick={handleSubmit} disabled={!canSubmit}>
                        {loading ? "Отправляем..." : "Отправить"}
                    </button>
                </div>

                <p className="reviewHint">
                    Отзыв можно оставить только один раз для этого заказа.
                </p>
            </div>
        </div>
    );
}