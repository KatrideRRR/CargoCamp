import React from "react";

export default function ChatReplyQuote({
                                           message,
                                           currentUserId,
                                           otherUserName = "Собеседник",
                                           onClick,
                                       }) {
    if (!message) {
        return (
            <div className="chat-reply-quote">
                <div className="chat-reply-quote-author">
                    Сообщение
                </div>

                <div className="chat-reply-quote-text">
                    Исходное сообщение недоступно
                </div>
            </div>
        );
    }

    const isMine =
        String(message.senderId) ===
        String(currentUserId);

    const author = isMine
        ? "Вы"
        : otherUserName;

    const rawContent =
        String(message.content || "").trim();

    const preview =
        rawContent.length > 140
            ? `${rawContent.slice(0, 140)}…`
            : rawContent;

    const Element = onClick ? "button" : "div";

    return (
        <Element
            type={onClick ? "button" : undefined}
            className="chat-reply-quote"
            onClick={onClick}
            title={
                onClick
                    ? "Перейти к исходному сообщению"
                    : undefined
            }
        >
            <span className="chat-reply-quote-author">
                {author}
            </span>

            <span className="chat-reply-quote-text">
                {preview || "Сообщение"}
            </span>
        </Element>
    );
}