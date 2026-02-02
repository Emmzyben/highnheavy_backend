const { pool } = require('./config/database');
const dotenv = require('dotenv');
dotenv.config();

const updateSchema = async () => {
    try {
        console.log('Adding photos column to vehicles table...');

        // Add photos column as JSON
        await pool.query('ALTER TABLE vehicles ADD COLUMN photos JSON AFTER dimensions');

        console.log('Column photos added successfully.');
        process.exit(0);
    } catch (error) {
        if (error.code === 'ER_DUP_COLUMN_NAME') {
            console.log('Column photos already exists.');
            process.exit(0);
        } else {
            console.error('Error updating schema:', error);
            process.exit(1);
        }
    }
};

updateSchema();
