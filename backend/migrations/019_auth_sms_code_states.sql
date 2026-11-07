CREATE TABLE IF NOT EXISTS auth_sms_code_states (
                                                    phone VARCHAR(20) NOT NULL,

    purpose VARCHAR(20) NULL,

    code_hash CHAR(64)
    CHARACTER SET ascii
    COLLATE ascii_bin
    NULL,

    status ENUM('idle', 'pending', 'active')
    NOT NULL DEFAULT 'idle',

    attempts TINYINT UNSIGNED
    NOT NULL DEFAULT 0,

    reservation_id CHAR(36) NULL,
    pending_until DATETIME(3) NULL,
    expires_at DATETIME(3) NULL,

    last_sent_at DATETIME(3) NULL,
    window_started_at DATETIME(3) NULL,
    send_count INT UNSIGNED
    NOT NULL DEFAULT 0,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (phone),

    KEY idx_auth_sms_expiry (expires_at),
    KEY idx_auth_sms_updated (updated_at)
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;