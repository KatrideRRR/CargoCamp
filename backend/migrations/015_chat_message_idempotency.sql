-- Один логический запрос отправки = одно сообщение.
-- NULL оставляет совместимость со старыми клиентами.

ALTER TABLE messages
    ADD COLUMN clientMessageId VARCHAR(36) NULL,
    ADD UNIQUE KEY uq_messages_sender_client_message (
        senderId,
        clientMessageId
    );