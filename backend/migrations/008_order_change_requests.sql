CREATE TABLE order_change_requests (
                                       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                       order_id INT NOT NULL,
                                       proposed_by_id INT NOT NULL,
                                       responded_by_id INT NULL,

                                       base_price_kopecks INT NOT NULL,
                                       proposed_price_kopecks INT NOT NULL,

                                       additional_work TEXT NOT NULL,
                                       status VARCHAR(40) NOT NULL DEFAULT 'pending',

                                       agreement_contract_id BIGINT UNSIGNED NULL,

                                       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                       responded_at DATETIME(3) NULL,
                                       applied_at DATETIME(3) NULL,

                                       PRIMARY KEY (id),

                                       INDEX idx_order_changes_order (order_id, id),
                                       INDEX idx_order_changes_status (order_id, status),

                                       CONSTRAINT fk_order_changes_order
                                           FOREIGN KEY (order_id)
                                               REFERENCES orders(id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;