/*
 * CargoCamp
 * Migration 003
 * Electronic Signature Foundation
 *
 * Соглашения об электронной подписи.
 * Одноразовые подтверждения документов.
 */

CREATE TABLE IF NOT EXISTS electronic_signature_agreements
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    user_id INT NOT NULL,

    jurisdiction VARCHAR(16) NOT NULL DEFAULT 'RU',

    policy_code VARCHAR(100) NOT NULL,

    policy_version VARCHAR(30) NOT NULL,

    policy_sha256 CHAR(64) NOT NULL,

    accepted_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    ip_address VARCHAR(64) NULL,

    user_agent TEXT NULL,

    evidence JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_signature_agreement_version
(
    user_id,
    jurisdiction,
    policy_code,
    policy_version
),

    KEY idx_signature_agreements_user
(user_id),

    CONSTRAINT fk_signature_agreements_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/*
 * Каждый SMS-код привязан к конкретному
 * пользователю и конкретной версии документа.
 */

CREATE TABLE IF NOT EXISTS signature_challenges
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    contract_id BIGINT UNSIGNED NOT NULL,

    user_id INT NOT NULL,

    agreement_id BIGINT UNSIGNED NOT NULL,

    party_role VARCHAR(32) NOT NULL,

    method VARCHAR(32)
    NOT NULL DEFAULT 'otp_sms',

    document_hash CHAR(64) NOT NULL,

    code_hash CHAR(64) NOT NULL,

    code_salt CHAR(32) NOT NULL,

    recipient_fingerprint CHAR(64) NULL,

    recipient_masked VARCHAR(60) NULL,

    status VARCHAR(32)
    NOT NULL DEFAULT 'pending',

    attempts_count SMALLINT UNSIGNED
    NOT NULL DEFAULT 0,

    max_attempts SMALLINT UNSIGNED
    NOT NULL DEFAULT 5,

    expires_at DATETIME(3) NOT NULL,

    verified_at DATETIME(3) NULL,

    consumed_at DATETIME(3) NULL,

    provider_reference VARCHAR(191) NULL,

    ip_address VARCHAR(64) NULL,

    user_agent TEXT NULL,

    evidence JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_signature_challenges_contract
(contract_id),

    KEY idx_signature_challenges_user
(user_id),

    KEY idx_signature_challenges_status
(status),

    KEY idx_signature_challenges_expires
(expires_at),

    KEY idx_signature_challenges_agreement
(agreement_id),

    CONSTRAINT fk_signature_challenges_contract
    FOREIGN KEY (contract_id)
    REFERENCES contracts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_signature_challenges_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_signature_challenges_agreement
    FOREIGN KEY (agreement_id)
    REFERENCES electronic_signature_agreements (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;