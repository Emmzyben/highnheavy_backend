const { pool } = require('./config/database');
const dotenv = require('dotenv');
dotenv.config();

const updateSchema = async () => {
    try {
        console.log('Adding delivery columns to bookings table...');

        // Add delivery columns
        await pool.query('ALTER TABLE bookings ADD COLUMN delivery_photos JSON AFTER status');
        await pool.query('ALTER TABLE bookings ADD COLUMN delivery_signature TEXT AFTER delivery_photos');
        await pool.query('ALTER TABLE bookings ADD COLUMN receiver_name VARCHAR(255) AFTER delivery_signature');

        console.log('Delivery columns added successfully.');
        process.exit(0);
    } catch (error) {
        if (error.code === 'ER_DUP_COLUMN_NAME') {
            console.log('Delivery columns already exist.');
            process.exit(0);
        } else {
            console.error('Error updating schema:', error);
            process.exit(1);
        }
    }
};

updateSchema();
