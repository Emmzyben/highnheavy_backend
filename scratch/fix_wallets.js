const { pool } = require('../config/database');

async function fixMissingWallets() {
    try {
        console.log('Ensuring all users have wallets...');
        const [result] = await pool.query(`
            INSERT IGNORE INTO wallets (user_id, balance, pending_balance, currency)
            SELECT id, 0.00, 0.00, 'USD' FROM users
        `);
        console.log(`✅ Success! Rows affected: ${result.affectedRows}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error fixing wallets:', error);
        process.exit(1);
    }
}

fixMissingWallets();
