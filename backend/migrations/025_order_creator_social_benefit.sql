
ALTER TABLE orders
    ADD COLUMN creator_social_benefit_at_creation
        TINYINT(1) NULL DEFAULT NULL;

ALTER TABLE express_orders
    ADD COLUMN creator_social_benefit_at_creation
        TINYINT(1) NULL DEFAULT NULL;
