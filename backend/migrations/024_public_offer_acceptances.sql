
CREATE TABLE IF NOT EXISTS user_public_offer_acceptances (
                                                             id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                                             user_id INT NOT NULL,
                                                             offer_version VARCHAR(20) NOT NULL,

    offer_sha256 CHAR(64)
    CHARACTER SET ascii
    COLLATE ascii_bin
    NOT NULL,

    accepted_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    source VARCHAR(20) NOT NULL,
    ip_address VARCHAR(64) NULL,
    user_agent TEXT NULL,

    PRIMARY KEY (id),

    UNIQUE KEY uq_public_offer_user_version (
                                                user_id,
                                                offer_version
                                            ),

    KEY idx_public_offer_accepted_at (accepted_at),

    CONSTRAINT fk_public_offer_acceptance_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;
