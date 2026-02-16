const { pool } = require('./config/database');

async function fixSchema() {
    try {
        console.log('Attempting to fix bookings status constraint...');

        // 1. Drop the named constraint if it exists (to avoid duplicates or conflicts)
        try {
            await pool.query('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
            console.log('Dropped existing bookings_status_check');
        } catch (e) {
            console.log('No named constraint bookings_status_check found to drop');
        }

        // 2. Modify the column to remove the inline check and set the new one
        // Note: Inline check constraints are sometimes hard to drop individually if they don't have names.
        // We can rename the column and rename it back, or just use MODIFY.

        await pool.query(`
            ALTER TABLE bookings MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending_quote' 
            CHECK (status IN ('pending_quote', 'quoted', 'awaiting_payment', 'booked', 'in_transit', 'delivered', 'cancelled', 'completed'))
        `);

        console.log('Column status modified with updated check constraint');

        process.exit(0);
    } catch (error) {
        console.error('Migration Error:', error);
        process.exit(1);
    }
}

fixSchema();
