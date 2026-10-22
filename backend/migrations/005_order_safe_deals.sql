
CREATE TABLE IF NOT EXISTS order_safe_deals (
                                                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                order_id INT NOT NULL,
                                                creator_id INT NOT NULL,

                                                provider VARCHAR(40) NOT NULL
    DEFAULT 'yookassa',

    provider_deal_id VARCHAR(100) NULL,
    provider_payment_id VARCHAR(100) NULL,

    -- Фиксированные ключи повторяемых запросов.
    deal_idempotence_key CHAR(36) NOT NULL,
    payment_idempotence_key CHAR(36) NOT NULL,

    -- Все суммы исключительно в копейках.
    expected_amount_kopecks BIGINT UNSIGNED NOT NULL,
    seller_payout_kopecks BIGINT UNSIGNED NOT NULL,
    platform_fee_kopecks BIGINT UNSIGNED NOT NULL,

    funded_amount_kopecks BIGINT UNSIGNED NOT NULL
    DEFAULT 0,

    status VARCHAR(40) NOT NULL
    DEFAULT 'initialized',

    provider_payment_status VARCHAR(40) NULL,
    provider_deal_status VARCHAR(40) NULL,

    fee_moment VARCHAR(40) NOT NULL
    DEFAULT 'deal_closed',

    expires_at DATETIME(3) NULL,
    funded_at DATETIME(3) NULL,
    last_verified_at DATETIME(3) NULL,

    last_error_code VARCHAR(100) NULL,

    created_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_safe_deal_order (order_id),

    UNIQUE KEY uq_safe_deal_provider_deal
(provider_deal_id),

    UNIQUE KEY uq_safe_deal_provider_payment
(provider_payment_id),

    UNIQUE KEY uq_safe_deal_create_key
(deal_idempotence_key),

    UNIQUE KEY uq_safe_deal_payment_key
(payment_idempotence_key),

    KEY idx_safe_deals_status (status),
    KEY idx_safe_deals_expiry (expires_at),
    KEY idx_safe_deals_creator (creator_id),

    CONSTRAINT fk_safe_deal_order
    FOREIGN KEY (order_id)
    REFERENCES orders(id)
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4;
