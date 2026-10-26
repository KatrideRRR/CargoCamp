CREATE TABLE order_completion_decisions (
                                            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                            order_id INT NOT NULL,
                                            user_id INT NOT NULL,
                                            party_role VARCHAR(20) NOT NULL,

                                            quality_decision VARCHAR(20) NULL,
                                            remarks TEXT NULL,

                                            cash_status VARCHAR(20) NULL,
                                            cash_amount_kopecks BIGINT UNSIGNED NULL,

                                            payout_authorized BOOLEAN NOT NULL DEFAULT FALSE,

                                            confirmed_at DATETIME(3) NOT NULL,
                                            ip_address VARCHAR(64) NULL,
                                            user_agent TEXT NULL,

                                            PRIMARY KEY (id),

                                            UNIQUE KEY uq_completion_order_user (
                                                order_id,
                                                user_id
                                                ),

                                            CONSTRAINT fk_completion_order
                                                FOREIGN KEY (order_id) REFERENCES orders(id),

                                            CONSTRAINT fk_completion_user
                                                FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;