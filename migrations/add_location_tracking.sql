-- Add location tracking columns to drivers table
ALTER TABLE drivers 
ADD COLUMN IF NOT EXISTS current_latitude DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS current_longitude DECIMAL(11, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP NULL DEFAULT NULL;

-- Add latitude/longitude to bookings table for pickup and delivery locations
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS pickup_latitude DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS pickup_longitude DECIMAL(11, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8) DEFAULT NULL;

-- Create driver location history table for tracking movement over time
CREATE TABLE IF NOT EXISTS driver_location_history (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    driver_id VARCHAR(36) NOT NULL,
    booking_id VARCHAR(36),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    INDEX idx_driver_location_history_driver (driver_id),
    INDEX idx_driver_location_history_booking (booking_id),
    INDEX idx_driver_location_history_time (recorded_at)
);

-- Add comments for documentation
ALTER TABLE drivers 
MODIFY COLUMN current_latitude DECIMAL(10, 8) DEFAULT NULL COMMENT 'Driver current latitude for live tracking',
MODIFY COLUMN current_longitude DECIMAL(11, 8) DEFAULT NULL COMMENT 'Driver current longitude for live tracking',
MODIFY COLUMN location_updated_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last time location was updated';

ALTER TABLE bookings
MODIFY COLUMN pickup_latitude DECIMAL(10, 8) DEFAULT NULL COMMENT 'Pickup location latitude',
MODIFY COLUMN pickup_longitude DECIMAL(11, 8) DEFAULT NULL COMMENT 'Pickup location longitude',
MODIFY COLUMN delivery_latitude DECIMAL(10, 8) DEFAULT NULL COMMENT 'Delivery location latitude',
MODIFY COLUMN delivery_longitude DECIMAL(11, 8) DEFAULT NULL COMMENT 'Delivery location longitude';
