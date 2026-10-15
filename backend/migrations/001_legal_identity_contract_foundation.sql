/*
 * CargoCamp
 * Verification & Contract Foundation
 *
 * Migration: 001
 *
 * ВАЖНО:
 * После применения этот файл не изменять.
 * Любые дальнейшие изменения делаем новой миграцией.
 */


/* =========================================================
   IDENTITY VERIFICATIONS
   ========================================================= */

CREATE TABLE IF NOT EXISTS identity_verifications
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    user_id INT NOT NULL,

    status VARCHAR(32) NOT NULL DEFAULT 'pending',

    provider VARCHAR(64) NOT NULL DEFAULT 'manual',

    country_code CHAR(2) NOT NULL DEFAULT 'RU',

    assurance_level VARCHAR(32)
    NOT NULL DEFAULT 'basic',

    verification_method VARCHAR(64)
    NOT NULL DEFAULT 'document_review',

    provider_reference VARCHAR(191) NULL,

    verified_at DATETIME(3) NULL,

    expires_at DATETIME(3) NULL,

    reviewed_by INT NULL,

    rejection_reason TEXT NULL,

    metadata JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_identity_verifications_user
(user_id),

    KEY idx_identity_verifications_status
(status),

    KEY idx_identity_verifications_provider
(provider),

    KEY idx_identity_verifications_country
(country_code),

    KEY idx_identity_verifications_verified_at
(verified_at),

    KEY idx_identity_verifications_user_status
(user_id, status),

    KEY idx_identity_verifications_provider_ref
(provider, provider_reference),

    CONSTRAINT fk_identity_verifications_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_identity_verifications_reviewer
    FOREIGN KEY (reviewed_by)
    REFERENCES users (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/* =========================================================
   VERIFICATION DOCUMENTS
   ========================================================= */

CREATE TABLE IF NOT EXISTS verification_documents
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    verification_id BIGINT UNSIGNED NOT NULL,

    user_id INT NOT NULL,

    document_type VARCHAR(64) NOT NULL,

    storage_key VARCHAR(500) NOT NULL,

    mime_type VARCHAR(100) NULL,

    file_size BIGINT UNSIGNED NULL,

    file_hash CHAR(64) NOT NULL,

    is_encrypted TINYINT(1)
    NOT NULL DEFAULT 1,

    encryption_version VARCHAR(32) NULL,

    retention_until DATETIME(3) NULL,

    metadata JSON NULL,

    deleted_at DATETIME(3) NULL,

    deletion_reason VARCHAR(255) NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    KEY idx_verification_documents_verification
(verification_id),

    KEY idx_verification_documents_user
(user_id),

    KEY idx_verification_documents_type
(document_type),

    KEY idx_verification_documents_hash
(file_hash),

    KEY idx_verification_documents_deleted
(deleted_at),

    KEY idx_verification_documents_retention
(retention_until),

    CONSTRAINT fk_verification_documents_verification
    FOREIGN KEY (verification_id)
    REFERENCES identity_verifications (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_verification_documents_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/* =========================================================
   CONTRACTS
   ========================================================= */

CREATE TABLE IF NOT EXISTS contracts
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    order_id INT NOT NULL,

    parent_contract_id BIGINT UNSIGNED NULL,

    type VARCHAR(50)
    NOT NULL DEFAULT 'service_contract',

    version INT UNSIGNED
    NOT NULL DEFAULT 1,

    status VARCHAR(50)
    NOT NULL DEFAULT 'draft',

    document_number VARCHAR(100) NOT NULL,

    jurisdiction VARCHAR(16)
    NOT NULL DEFAULT 'RU',

    template_code VARCHAR(100)
    NOT NULL DEFAULT 'service_contract_default',

    template_version VARCHAR(30)
    NOT NULL DEFAULT '1',

    storage_key VARCHAR(500) NULL,

    document_hash CHAR(64) NULL,

    finalized_at DATETIME(3) NULL,

    fully_signed_at DATETIME(3) NULL,

    superseded_at DATETIME(3) NULL,

    metadata JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_contracts_document_number
(document_number),

    UNIQUE KEY uq_contracts_order_type_version
(order_id, type, version),

    KEY idx_contracts_order
(order_id),

    KEY idx_contracts_parent
(parent_contract_id),

    KEY idx_contracts_type
(type),

    KEY idx_contracts_status
(status),

    KEY idx_contracts_document_hash
(document_hash),

    CONSTRAINT fk_contracts_order
    FOREIGN KEY (order_id)
    REFERENCES orders (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_contracts_parent
    FOREIGN KEY (parent_contract_id)
    REFERENCES contracts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/* =========================================================
   CONTRACT SIGNATURES
   ========================================================= */

CREATE TABLE IF NOT EXISTS contract_signatures
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    contract_id BIGINT UNSIGNED NOT NULL,

    user_id INT NOT NULL,

    party_role VARCHAR(32) NOT NULL,

    method VARCHAR(50)
    NOT NULL DEFAULT 'otp_sms',

    document_hash CHAR(64) NOT NULL,

    signed_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    ip_address VARCHAR(64) NULL,

    user_agent TEXT NULL,

    verification_id BIGINT UNSIGNED NULL,

    verification_snapshot JSON NULL,

    signature_policy_code VARCHAR(100) NULL,

    signature_policy_version VARCHAR(30) NULL,

    external_reference VARCHAR(191) NULL,

    evidence JSON NULL,

    created_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    updated_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),

    UNIQUE KEY uq_contract_signature_party
(
    contract_id,
    user_id,
    party_role
),

    KEY idx_contract_signatures_contract
(contract_id),

    KEY idx_contract_signatures_user
(user_id),

    KEY idx_contract_signatures_verification
(verification_id),

    KEY idx_contract_signatures_signed_at
(signed_at),

    KEY idx_contract_signatures_hash
(document_hash),

    CONSTRAINT fk_contract_signatures_contract
    FOREIGN KEY (contract_id)
    REFERENCES contracts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_contract_signatures_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_contract_signatures_verification
    FOREIGN KEY (verification_id)
    REFERENCES identity_verifications (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;


/* =========================================================
   CONTRACT EVENTS
   ========================================================= */

CREATE TABLE IF NOT EXISTS contract_events
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    contract_id BIGINT UNSIGNED NOT NULL,

    actor_user_id INT NULL,

    actor_role VARCHAR(32)
    NOT NULL DEFAULT 'system',

    event_type VARCHAR(80) NOT NULL,

    event_at DATETIME(3)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    ip_address VARCHAR(64) NULL,

    user_agent TEXT NULL,

    request_id VARCHAR(64) NULL,

    previous_event_hash CHAR(64) NULL,

    event_hash CHAR(64) NULL,

    metadata JSON NULL,

    PRIMARY KEY (id),

    KEY idx_contract_events_contract
(contract_id),

    KEY idx_contract_events_type
(event_type),

    KEY idx_contract_events_time
(event_at),

    KEY idx_contract_events_actor
(actor_user_id),

    KEY idx_contract_events_contract_time
(contract_id, event_at),

    KEY idx_contract_events_hash
(event_hash),

    CONSTRAINT fk_contract_events_contract
    FOREIGN KEY (contract_id)
    REFERENCES contracts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

    CONSTRAINT fk_contract_events_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES users (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
    )
    ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci;