ALTER TABLE express_orders
    MODIFY COLUMN status ENUM(
    'created',
    'reserved',
    'accepted',
    'on_the_way_to_A',
    'arrived_at_A',
    'waiting_at_A',
    'picked_up',
    'in_progress',
    'completed',
    'cancelled'
    ) NOT NULL DEFAULT 'created';

ALTER TABLE express_orders
    ADD COLUMN reservation_source_order_id
        INT UNSIGNED NULL,

    ADD COLUMN reservation_approved_at
        DATETIME(3) NULL,

    ADD COLUMN reservation_activated_at
        DATETIME(3) NULL,

    ADD INDEX idx_express_reservation_source (
        reservation_source_order_id,
        status
    );

CREATE TABLE IF NOT EXISTS express_reservation_requests (
                                                            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                                                            order_id INT UNSIGNED NOT NULL,

                                                            source_order_id INT UNSIGNED NOT NULL,

                                                            executor_id INT NOT NULL,

                                                            status ENUM(
                                                            'pending',
                                                            'approved',
                                                            'rejected',
                                                            'cancelled',
                                                            'expired'
) NOT NULL DEFAULT 'pending',

    distance_to_destination_m INT UNSIGNED NOT NULL,

    created_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3),

    expires_at DATETIME(3) NOT NULL,

    resolved_at DATETIME(3) NULL,

    PRIMARY KEY (id),

    INDEX idx_express_request_order (
                                        order_id,
                                        status
                                    ),

    INDEX idx_express_request_executor (
                                           executor_id,
                                           status
                                       ),

    INDEX idx_express_request_expiry (
                                         status,
                                         expires_at
                                     )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4;