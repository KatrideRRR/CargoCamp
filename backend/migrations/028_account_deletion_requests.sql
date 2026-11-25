CREATE TABLE IF NOT EXISTS account_deletion_requests (
                                                         id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                         user_id INT NOT NULL,

                                                         status ENUM(
                                                         'requested',
                                                         'processing',
                                                         'completed',
                                                         'rejected'
) NOT NULL DEFAULT 'requested',

    requested_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    processed_at DATETIME(3) NULL,

    review_note TEXT NULL,

    PRIMARY KEY (id),

    INDEX idx_account_deletion_user (
                                        user_id,
                                        status
                                    ),

    INDEX idx_account_deletion_status (
                                          status,
                                          requested_at
                                      )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4;