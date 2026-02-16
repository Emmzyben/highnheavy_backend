const { pool } = require('./config/database');

async function setupWalletSystem() {
    const connection = await pool.getConnection();
    try {
        console.log('Setting up wallet system...');

        await connection.beginTransaction();

        // 1. Add pending_balance to wallets table if it doesn't exist
        const [pendingBalanceColumn] = await connection.query(`
            SHOW COLUMNS FROM wallets LIKE 'pending_balance'
        `);

        if (pendingBalanceColumn.length === 0) {
            console.log('Adding pending_balance to wallets table...');
            await connection.query(`
                ALTER TABLE wallets 
                ADD COLUMN pending_balance DECIMAL(12,2) DEFAULT 0.00 AFTER balance
            `);
        }

        // 2. Create bank_accounts table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS bank_accounts (
                id CHAR(36) PRIMARY KEY,
                user_id CHAR(36) NOT NULL,
                account_holder_name VARCHAR(255) NOT NULL,
                bank_name VARCHAR(255) NOT NULL,
                account_number VARCHAR(100) NOT NULL,
                routing_number VARCHAR(50),
                swift_code VARCHAR(50),
                iban VARCHAR(50),
                account_type VARCHAR(50) DEFAULT 'checking',
                is_primary BOOLEAN DEFAULT TRUE,
                is_verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Bank accounts table created/verified');

        // 3. Create withdrawals table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id CHAR(36) PRIMARY KEY,
                user_id CHAR(36) NOT NULL,
                bank_account_id CHAR(36) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                processed_by CHAR(36),
                
                admin_notes TEXT,
                rejection_reason TEXT,
                transaction_reference VARCHAR(100),
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
                FOREIGN KEY (processed_by) REFERENCES users(id)
            )
        `);
        console.log('✅ Withdrawals table created/verified');

        // 4. Add carrier_amount and escort_amount to payments table
        const [carrierAmountColumn] = await connection.query(`
            SHOW COLUMNS FROM payments LIKE 'carrier_amount'
        `);

        if (carrierAmountColumn.length === 0) {
            console.log('Adding carrier_amount and escort_amount to payments table...');
            await connection.query(`
                ALTER TABLE payments 
                ADD COLUMN carrier_amount DECIMAL(12,2) DEFAULT 0.00 AFTER amount,
                ADD COLUMN escort_amount DECIMAL(12,2) DEFAULT 0.00 AFTER carrier_amount
            `);
        }

        // 5. Create wallets for all users if they don't have one
        await connection.query(`
            INSERT INTO wallets (user_id, balance, pending_balance, currency)
            SELECT id, 0.00, 0.00, 'USD'
            FROM users
            WHERE id NOT IN (SELECT user_id FROM wallets)
        `);
        console.log('✅ Created wallets for all users');

        await connection.commit();
        console.log('✅ Wallet system setup completed successfully!');

    } catch (error) {
        await connection.rollback();
        console.error('❌ Wallet system setup failed:', error);
        throw error;
    } finally {
        connection.release();
        await pool.end();
    }
}

// Run the setup
setupWalletSystem()
    .then(() => {
        console.log('Setup script finished');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Setup script failed:', error);
        process.exit(1);
    });
