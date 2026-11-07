/*
 * Перенос ранее назначенных пенсионных льгот.
 *
 * НЕ переносим пользователей, у которых уже
 * есть запись по pension_recipient.
 *
 * Так мы не отменяем существующие решения
 * об отказе, отзыве или проверке.
 */

INSERT INTO user_benefit_verifications (
    user_id,
    country_code,
    benefit_code,
    status,
    provider,
    verification_method,
    submitted_at,
    verified_at,
    expires_at,
    decision_reason,
    metadata,
    created_at,
    updated_at
)
SELECT
    u.id,
    'RU',
    'pension_recipient',
    'verified',
    'legacy_admin_status',
    'legacy_user_status_migration',
    UTC_TIMESTAMP(3),
    UTC_TIMESTAMP(3),
    DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 YEAR),
    'Перенос ранее назначенного пенсионного статуса',
    JSON_OBJECT(
            'source', 'users.userStatus',
            'originalValue', 'pensioner',
            'migration', '020',
            'requiresReverification', TRUE
    ),
    UTC_TIMESTAMP(3),
    UTC_TIMESTAMP(3)
FROM users AS u
WHERE LOWER(TRIM(u.userStatus)) = 'pensioner'
  AND NOT EXISTS (
    SELECT 1
    FROM user_benefit_verifications AS b
    WHERE b.user_id = u.id
      AND b.country_code = 'RU'
      AND b.benefit_code = 'pension_recipient'
);