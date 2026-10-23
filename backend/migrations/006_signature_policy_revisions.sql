
CREATE TABLE IF NOT EXISTS signature_policy_revisions (
                                                          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                          jurisdiction VARCHAR(16) NOT NULL,
    policy_code VARCHAR(100) NOT NULL,
    policy_version VARCHAR(30) NOT NULL,

    policy_sha256 CHAR(64) NOT NULL,
    policy_text LONGTEXT NOT NULL,

    archived_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_signature_policy_identity (
                                                jurisdiction,
                                                policy_code,
                                                policy_version
                                            ),

    KEY idx_signature_policy_hash (
                                      policy_sha256
                                  )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;
