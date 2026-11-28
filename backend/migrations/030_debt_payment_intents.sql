CREATE TABLE IF NOT EXISTS debt_payment_intents (
                                                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                    user_id BIGINT UNSIGNED NOT NULL,

                                                    order_id BIGINT UNSIGNED NULL,

                                                    proposed_sum INT UNSIGNED NULL,
                                                    request_comment VARCHAR(1000) NULL,
    available_at DATETIME(3) NULL,

    provider VARCHAR(16) NOT NULL,
    payment_mode VARCHAR(24) NOT NULL,

    amount_kopecks INT UNSIGNED NOT NULL,

    idempotency_key VARCHAR(64) NOT NULL,

    provider_payment_id VARCHAR(128) NULL,
    provider_order_id VARCHAR(64) NULL,

    confirmation_url TEXT NULL,

    payment_status VARCHAR(24) NOT NULL DEFAULT 'created',

    request_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    request_error VARCHAR(500) NULL,

    expires_at DATETIME(3) NOT NULL,

    created_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_debt_intent_idempotency (
                                              idempotency_key
                                          ),

    UNIQUE KEY uq_debt_provider_payment (
                                            provider,
                                            provider_payment_id
                                        ),

    UNIQUE KEY uq_debt_provider_order (
                                          provider,
                                          provider_order_id
                                      ),

    KEY idx_debt_intent_user (
                                 user_id,
                                 payment_status
                             ),

    KEY idx_debt_intent_request (
                                    request_status,
                                    expires_at
                                )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;