CREATE TABLE IF NOT EXISTS auth_sessions (
                                             id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                             user_id INT NOT NULL,

    -- admin или user
                                             scope VARCHAR(20) NOT NULL,

    -- Храним SHA-256, а не сам refresh-token
    token_hash CHAR(64)
    CHARACTER SET ascii
    COLLATE ascii_bin
    NOT NULL,

    expires_at DATETIME(3) NOT NULL,
    absolute_expires_at DATETIME(3) NOT NULL,

    revoked_at DATETIME(3) NULL,
    last_used_at DATETIME(3) NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_auth_sessions_token_hash (
                                               token_hash
                                           ),

    KEY idx_auth_sessions_user (
                                   user_id,
                                   scope
                               ),

    KEY idx_auth_sessions_expiry (
                                     expires_at
                                 ),

    CONSTRAINT fk_auth_sessions_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;