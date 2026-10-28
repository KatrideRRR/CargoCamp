ALTER TABLE orders
    ADD COLUMN commission_amount_kopecks INT NOT NULL DEFAULT 0,
    ADD COLUMN commission_accrued_at DATETIME(3) NULL;