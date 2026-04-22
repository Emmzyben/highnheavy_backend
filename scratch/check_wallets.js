const { pool } = require('../config/database');

async function checkWallets() {
    try {
        console.log('--- Wallets Table Structure ---');
        const [columns] = await pool.query('DESCRIBE wallets');
        console.table(columns);

        console.log('\n--- Admin User(s) ---');
        const [admins] = await pool.query('SELECT id, full_name, role FROM users WHERE role = "admin"');
        console.table(admins);

        console.log('\n--- Admin Wallet(s) ---');
        if (admins.length > 0) {
            const adminIds = admins.map(a => a.id);
            const [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id IN (?)', [adminIds]);
            console.table(wallets);
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkWallets();
