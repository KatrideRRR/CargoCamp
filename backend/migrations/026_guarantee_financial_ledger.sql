-- Фиксированный финансовый расчёт гарантийного заказа.
-- Отдельно от уже существующей order_safe_deals.

CREATE TABLE guarantee_financial_snapshots (
                                               id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                               order_id INT NOT NULL,
                                               creator_id INT NOT NULL,
                                               executor_id INT NULL,

                                               pricing_version VARCHAR(80) NOT NULL,

                                               pricing_parameters_json JSON NOT NULL,
                                               locked_at DATETIME(3) NULL,

                                               work_price_kopecks BIGINT UNSIGNED NOT NULL,
                                               buyer_fee_kopecks BIGINT UNSIGNED NOT NULL,
                                               executor_fee_kopecks BIGINT UNSIGNED NOT NULL,
                                               platform_fee_kopecks BIGINT UNSIGNED NOT NULL,
                                               promotion_kopecks BIGINT UNSIGNED NOT NULL DEFAULT 0,

                                               customer_total_kopecks BIGINT UNSIGNED NOT NULL,
                                               executor_payout_kopecks BIGINT UNSIGNED NOT NULL,

                                               provider VARCHAR(40) NULL,

                                               status ENUM(
        'quoted',
        'awaiting_payment',
        'paid',
        'cancelled'
    ) NOT NULL DEFAULT 'quoted',

                                               created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                               updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                               PRIMARY KEY (id),
                                               UNIQUE KEY uq_guarantee_snapshot_order (order_id),

                                               CONSTRAINT fk_guarantee_snapshot_order
                                                   FOREIGN KEY (order_id) REFERENCES orders(id),

                                               CONSTRAINT chk_guarantee_fee_split
                                                   CHECK (
                                                       platform_fee_kopecks =
                                                       buyer_fee_kopecks + executor_fee_kopecks
                                                       ),

                                               CONSTRAINT chk_guarantee_customer_total
                                                   CHECK (
                                                       customer_total_kopecks =
                                                       work_price_kopecks +
                                                       buyer_fee_kopecks +
                                                       promotion_kopecks
                                                       ),

                                               CONSTRAINT chk_guarantee_executor_payout
                                                   CHECK (
                                                       executor_payout_kopecks +
                                                       executor_fee_kopecks =
                                                       work_price_kopecks
                                                           AND executor_payout_kopecks > 0
                                                       )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Отдельный реестр обязательств перед исполнителями.

CREATE TABLE guarantee_payouts (
                                   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                   snapshot_id BIGINT UNSIGNED NOT NULL,
                                   executor_id INT NOT NULL,

                                   amount_kopecks BIGINT UNSIGNED NOT NULL,

                                   status ENUM(
        'pending_acceptance',
        'awaiting_requisites',
        'ready',
        'processing',
        'paid',
        'failed',
        'suspended',
        'cancelled'
    ) NOT NULL DEFAULT 'pending_acceptance',

                                   paid_at DATETIME(3) NULL,

                                   created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                   updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                   PRIMARY KEY (id),
                                   UNIQUE KEY uq_guarantee_payout_snapshot (snapshot_id),

                                   KEY idx_guarantee_payout_status (status, created_at),

                                   CONSTRAINT fk_guarantee_payout_snapshot
                                       FOREIGN KEY (snapshot_id)
                                           REFERENCES guarantee_financial_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Журнал попыток отправки денег.
-- Один и тот же банковский перевод нельзя повторить
-- с другим ключом без проверки предыдущего результата.

CREATE TABLE guarantee_payout_attempts (
                                           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                           payout_id BIGINT UNSIGNED NOT NULL,

                                           provider VARCHAR(40) NOT NULL,
                                           idempotency_key CHAR(36) NOT NULL,
                                           provider_transfer_id VARCHAR(128) NULL,

                                           status ENUM(
        'prepared',
        'processing',
        'succeeded',
        'failed',
        'unknown'
    ) NOT NULL DEFAULT 'prepared',

                                           error_code VARCHAR(100) NULL,

                                           created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                           updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                           PRIMARY KEY (id),

                                           UNIQUE KEY uq_guarantee_payout_attempt_key (idempotency_key),
                                           UNIQUE KEY uq_guarantee_provider_transfer (
                                               provider, provider_transfer_id
                                               ),

                                           KEY idx_guarantee_attempt_payout (payout_id),

                                           CONSTRAINT fk_guarantee_attempt_payout
                                               FOREIGN KEY (payout_id)
                                                   REFERENCES guarantee_payouts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;