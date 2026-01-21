const { pool } = require('./config/database');

async function fixSchema() {
    try {
        console.log('Checking schema...');

        // Check for 'status' column in users
        const [columns] = await pool.query('SHOW COLUMNS FROM users LIKE "status"');
        if (columns.length === 0) {
            console.log('Adding "status" column to users table...');
            await pool.query('ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT "active" AFTER profile_completed');
            console.log('"status" column added.');
        } else {
            console.log('"status" column already exists.');
        }

        console.log('Schema check complete.');
        process.exit(0);
    } catch (error) {
        console.error('Error fixing schema:', error);
        process.exit(1);
    }
}

fixSchema();
