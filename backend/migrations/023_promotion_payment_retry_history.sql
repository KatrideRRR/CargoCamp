CREATE TABLE promotion_payment_retry_history (
                                                 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                                 order_id INT NOT NULL,
                                                 user_id INT NOT NULL,
                                                 provider VARCHAR(20) NOT NULL,
                                                 payment_mode VARCHAR(20) NOT NULL,
                                                 amount_kopecks INT NOT NULL,
                                                 idempotency_key CHAR(36) NOT NULL,
                                                 bank_order_id VARCHAR(128) NOT NULL,
                                                 payment_id VARCHAR(128) NOT NULL,
                                                 previous_state VARCHAR(40) NOT NULL,
                                                 previous_status VARCHAR(40) NULL,
                                                 verified_terminal_status VARCHAR(40) NOT NULL,
                                                 archived_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

                                                 PRIMARY KEY (id),
                                                 UNIQUE KEY uq_promotion_retry_idempotency (idempotency_key),
                                                 KEY idx_promotion_retry_order (order_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;