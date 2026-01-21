const { pool } = require('./config/database');

async function addEmailNotificationsColumn() {
    try {
        console.log('Adding email_notifications column to users table...');

        // Check if column exists
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'highnheavy' 
            AND TABLE_NAME = 'users' 
            AND COLUMN_NAME = 'email_notifications'
        `);

        if (columns.length === 0) {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN email_notifications BOOLEAN DEFAULT TRUE
            `);
            console.log('✅ email_notifications column added successfully.');
        } else {
            console.log('✅ email_notifications column already exists.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating schema:', error);
        process.exit(1);
    }
}

addEmailNotificationsColumn();
