-- Test query to check if location columns exist and can be updated
SELECT 
    id,
    name, 
    current_latitude, 
    current_longitude,
    location_updated_at,
    status
FROM drivers
LIMIT 5;

-- If the above works, try updating a test driver's location
-- UPDATE drivers 
-- SET current_latitude = 37.7749, current_longitude = -122.4194, location_updated_at = NOW() 
-- WHERE id = 'your-driver-id';
