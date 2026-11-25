CREATE TABLE IF NOT EXISTS personal_data_consents (
                                                      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                      user_id INT NOT NULL,

                                                      consent_code VARCHAR(80) NOT NULL,
    consent_version VARCHAR(32) NOT NULL,
    consent_sha256 CHAR(64) NOT NULL,

    consent_text TEXT NOT NULL,

    accepted_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    revoked_at DATETIME(3) NULL,

    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(2048) NULL,

    PRIMARY KEY (id),

    INDEX idx_pd_consent_user (
                                  user_id,
                                  consent_code,
                                  revoked_at
                              ),

    INDEX idx_pd_consent_version (
                                     consent_code,
                                     consent_version
                                 )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4;