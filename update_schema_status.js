const { pool } = require('./config/database');

async function addStatusColumn() {
    try {
        console.log('Checking users table for status column...');

        // check if column exists
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'highnheavy' 
            AND TABLE_NAME = 'users' 
            AND COLUMN_NAME = 'status'
        `);

        if (columns.length === 0) {
            console.log('Adding status column to users table...');
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN status ENUM('active', 'disabled') DEFAULT 'active'
            `);
            console.log('Status column added successfully.');
        } else {
            console.log('Status column already exists.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error updating schema:', error);
        process.exit(1);
    }
}

addStatusColumn();
