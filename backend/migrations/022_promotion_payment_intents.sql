CREATE TABLE promotion_payment_intents (
                                           order_id INT NOT NULL,
                                           user_id INT NOT NULL,

                                           provider ENUM('yookassa', 'tbank') NOT NULL,
                                           payment_mode ENUM('saved', 'redirect') NOT NULL,

                                           amount_kopecks INT NOT NULL,
                                           idempotency_key CHAR(36) NOT NULL,
                                           bank_order_id VARCHAR(128) NOT NULL,

                                           payment_id VARCHAR(128) NULL,
                                           confirmation_url TEXT NULL,
                                           payment_status VARCHAR(40) NULL,

                                           state ENUM('creating', 'ready', 'failed')
        NOT NULL DEFAULT 'creating',

                                           created_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),

                                           updated_at DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                           PRIMARY KEY (order_id),

                                           UNIQUE KEY uq_promotion_intent_key (
                                               idempotency_key
                                               ),

                                           UNIQUE KEY uq_promotion_bank_order (
                                               bank_order_id
                                               ),

                                           UNIQUE KEY uq_promotion_provider_payment (
                                               provider,
                                               payment_id
                                               )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;