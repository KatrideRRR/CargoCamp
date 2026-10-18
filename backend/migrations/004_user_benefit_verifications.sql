/*
 * CargoCamp
 * Migration 004
 *
 * Verification of user benefits.
 *
 * RU pensioner support.
 * International benefit providers.
 */

CREATE TABLE IF NOT EXISTS user_benefit_verifications
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    user_id INT NOT NULL,

    country_code CHAR(2)
    NOT NULL DEFAULT 'RU',

    benefit_code VARCHAR(64) NOT NULL,

    status VARCHAR(32)
    NOT NULL DEFAULT 'pending',

    provider VARCHAR(64)
    NOT NULL DEFAULT 'manual',

    verification_method VARCHAR(64)
    NOT NULL DEFAULT 'document_review',

    provider_reference VARCHAR(191) NULL,

    submitted_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    reviewed_by INT NULL,

    reviewed_at DATETIME(3) NULL,

    verified_at DATETIME(3) NULL,

    expires_at DATETIME(3) NULL,

    revoked_at DATETIME(3) NULL,

    decision_reason VARCHAR(500) NULL,

    metadata JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_benefit_verifications_user
(user_id),

    KEY idx_benefit_verifications_code
(benefit_code),

    KEY idx_benefit_verifications_status
(status),

    KEY idx_benefit_verifications_country
(country_code),

    KEY idx_benefit_verifications_expires
(expires_at),

    KEY idx_benefit_verifications_lookup
(
    user_id,
    benefit_code,
    country_code,
    status
),

    CONSTRAINT fk_benefit_verifications_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_benefit_verifications_reviewer
    FOREIGN KEY (reviewed_by)
    REFERENCES users (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/*
 * Документы, подтверждающие право
 * на получение льготы.
 *
 * Не хранить в публичной папке /uploads.
 */

CREATE TABLE IF NOT EXISTS benefit_verification_documents
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    benefit_verification_id
    BIGINT UNSIGNED NOT NULL,

    user_id INT NOT NULL,

    document_type VARCHAR(64) NOT NULL,

    storage_key VARCHAR(500) NOT NULL,

    mime_type VARCHAR(100) NULL,

    file_size BIGINT UNSIGNED NULL,

    file_hash CHAR(64) NOT NULL,

    is_encrypted TINYINT(1)
    NOT NULL DEFAULT 0,

    retention_until DATETIME(3) NULL,

    deleted_at DATETIME(3) NULL,

    metadata JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_benefit_documents_verification
(benefit_verification_id),

    KEY idx_benefit_documents_user
(user_id),

    KEY idx_benefit_documents_hash
(file_hash),

    KEY idx_benefit_documents_retention
(retention_until),

    CONSTRAINT fk_benefit_documents_verification
    FOREIGN KEY (benefit_verification_id)
    REFERENCES user_benefit_verifications (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_benefit_documents_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;