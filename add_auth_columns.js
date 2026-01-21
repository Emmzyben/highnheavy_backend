const { pool } = require('./config/database');

async function addAuthColumns() {
    try {
        console.log('Adding auth columns to users table...');

        const columnsToAdd = [
            { name: 'verification_token', type: 'VARCHAR(255) NULL' },
            { name: 'email_verified', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'reset_token', type: 'VARCHAR(255) NULL' },
            { name: 'reset_token_expiry', type: 'DATETIME NULL' }
        ];

        for (const col of columnsToAdd) {
            // Check if column exists
            const [columns] = await pool.query(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = 'highnheavy' 
                AND TABLE_NAME = 'users' 
                AND COLUMN_NAME = ?
            `, [col.name]);

            if (columns.length === 0) {
                await pool.query(`
                    ALTER TABLE users 
                    ADD COLUMN ${col.name} ${col.type}
                `);
                console.log(`✅ ${col.name} column added successfully.`);
            } else {
                console.log(`✅ ${col.name} column already exists.`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating schema:', error);
        process.exit(1);
    }
}

addAuthColumns();
