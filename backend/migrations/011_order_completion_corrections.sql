CREATE TABLE order_completion_corrections (
                                              id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                              order_id INT NOT NULL,
                                              round_number INT UNSIGNED NOT NULL,
                                              event_type VARCHAR(20) NOT NULL,
                                              actor_user_id INT NOT NULL,
                                              comment TEXT NULL,
                                              event_at DATETIME(3) NOT NULL,

                                              PRIMARY KEY (id),

                                              KEY idx_completion_corrections_order (
        order_id,
        id
    ),

                                              CONSTRAINT fk_completion_corrections_order
                                                  FOREIGN KEY (order_id) REFERENCES orders(id),

                                              CONSTRAINT fk_completion_corrections_actor
                                                  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;