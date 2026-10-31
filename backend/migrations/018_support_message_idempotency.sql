-- Идентификатор попытки отправки сообщения поддержки.
-- Для старых приложений NULL разрешён.

ALTER TABLE SupportMessages
    ADD COLUMN clientMessageId VARCHAR(36) NULL,
    ADD UNIQUE KEY uq_support_sender_client_message (
        senderId,
        clientMessageId
    );