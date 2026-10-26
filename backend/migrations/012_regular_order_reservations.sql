ALTER TABLE orders
    MODIFY COLUMN status ENUM(
    'pending',
    'reserved',
    'active',
    'completed',
    'expired',
    'pending_payment'
    ) NOT NULL DEFAULT 'pending';

ALTER TABLE orders
    ADD COLUMN reservation_source_order_id INT NULL,
    ADD COLUMN reservation_available_at DATETIME NULL,
    ADD COLUMN reservation_approved_at DATETIME NULL,
    ADD COLUMN reservation_ready_at DATETIME NULL;