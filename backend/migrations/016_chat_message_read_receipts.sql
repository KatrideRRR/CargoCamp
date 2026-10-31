-- Отметка о прочтении сообщения получателем.
-- NULL означает, что прочтение не подтверждено.

ALTER TABLE messages
    ADD COLUMN readAt DATETIME(3) NULL;

-- Ускоряем поиск непрочитанных сообщений
-- конкретного получателя в конкретном заказе.

CREATE INDEX idx_messages_read_receipts
    ON messages (
                 orderType,
                 orderId,
                 receiverId,
                 senderId,
                 readAt,
                 id
        );