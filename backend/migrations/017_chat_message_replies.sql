-- Связь ответа с исходным сообщением.
-- NULL означает обычное сообщение без цитаты.

ALTER TABLE messages
    ADD COLUMN replyToMessageId INT NULL,
    ADD INDEX idx_messages_reply_to (replyToMessageId);