-- Два независимых способа привязки карты.
-- Пользователь самостоятельно выбирает банк
-- для автоматического списания комиссии.

ALTER TABLE users
    ADD COLUMN tbank_rebill_id VARCHAR(128) NULL,
    ADD COLUMN tbank_card_id VARCHAR(128) NULL,
    ADD COLUMN tbank_card_mask VARCHAR(32) NULL,
    ADD COLUMN tbank_card_bound_at DATETIME(3) NULL,
    ADD COLUMN auto_commission_provider
        ENUM('none', 'yookassa', 'tbank')
        NOT NULL DEFAULT 'none';

-- Единый журнал применённых платежей.
-- Один платёж одного провайдера нельзя применить дважды.

CREATE TABLE payment_receipts (
                                  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                  provider ENUM('yookassa', 'tbank') NOT NULL,
                                  payment_id VARCHAR(128) NOT NULL,
                                  user_id INT NOT NULL,
                                  purpose ENUM('debt', 'premium') NOT NULL,
                                  amount_kopecks INT NOT NULL,
                                  applied_kopecks INT NOT NULL DEFAULT 0,
                                  processed_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),

                                  PRIMARY KEY (id),
                                  UNIQUE KEY uq_payment_receipt (
                                      provider,
                                      payment_id
                                      ),
                                  KEY idx_payment_receipts_user (user_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Каждая попытка автоматического списания
-- должна иметь собственное состояние.

CREATE TABLE commission_charge_attempts (
                                            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                            source_type ENUM('regular', 'express') NOT NULL,
                                            source_id INT NOT NULL,
                                            user_id INT NOT NULL,
                                            provider ENUM('yookassa', 'tbank') NOT NULL,
                                            amount_kopecks INT NOT NULL,
                                            idempotency_key CHAR(36) NOT NULL,
                                            provider_payment_id VARCHAR(128) NULL,
                                            status ENUM(
        'prepared',
        'initiated',
        'pending',
        'succeeded',
        'failed',
        'unknown'
    ) NOT NULL DEFAULT 'prepared',
                                            created_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),
                                            updated_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                            PRIMARY KEY (id),
                                            UNIQUE KEY uq_commission_charge_source (
                                                source_type,
                                                source_id
                                                ),
                                            UNIQUE KEY uq_commission_charge_idempotency (
                                                idempotency_key
                                                ),
                                            UNIQUE KEY uq_commission_charge_payment (
                                                provider,
                                                provider_payment_id
                                                )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Для привязки Т-Банка необходимо помнить
-- первый платёж и подтверждение RebillId.

CREATE TABLE tbank_card_bind_attempts (
                                          payment_id VARCHAR(128) NOT NULL,
                                          user_id INT NOT NULL,
                                          rebill_id VARCHAR(128) NULL,
                                          card_id VARCHAR(128) NULL,
                                          card_mask VARCHAR(32) NULL,
                                          confirmed TINYINT(1) NOT NULL DEFAULT 0,
                                          created_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),

                                          PRIMARY KEY (payment_id),
                                          KEY idx_tbank_bind_user (user_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;