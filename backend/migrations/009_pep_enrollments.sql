CREATE TABLE pep_enrollments (
                                 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                 user_id INT NOT NULL,
                                 agreement_id BIGINT UNSIGNED NOT NULL,
                                 verification_id BIGINT UNSIGNED NOT NULL,
                                 bootstrap_signature_id BIGINT UNSIGNED NOT NULL,
                                 bootstrap_challenge_id BIGINT UNSIGNED NOT NULL,
                                 policy_code VARCHAR(100) NOT NULL,
                                 policy_version VARCHAR(30) NOT NULL,
                                 policy_sha256 CHAR(64) NOT NULL,
                                 phone_fingerprint CHAR(64) NOT NULL,
                                 activated_at DATETIME(3) NOT NULL,
                                 expires_at DATETIME(3) NOT NULL,
                                 revoked_at DATETIME(3) NULL,
                                 revoked_by INT NULL,
                                 revoke_reason VARCHAR(255) NULL,

                                 PRIMARY KEY (id),
                                 UNIQUE KEY uq_pep_user (user_id),
                                 KEY idx_pep_expiry (expires_at),

                                 CONSTRAINT fk_pep_user
                                     FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;