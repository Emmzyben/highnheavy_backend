const { pool } = require('./config/database');

async function setupFullWalletSystem() {
    const connection = await pool.getConnection();
    try {
        console.log('Setting up full wallet system...');

        await connection.beginTransaction();

        // 1. Create wallets table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                user_id CHAR(36) PRIMARY KEY,
                balance DECIMAL(12,2) DEFAULT 0.00,
                pending_balance DECIMAL(12,2) DEFAULT 0.00,
                currency VARCHAR(3) DEFAULT 'USD',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Wallets table created/verified');

        // 2. Create wallet_transactions table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
                wallet_id CHAR(36) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                type VARCHAR(50) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'payment_received', 'payment_sent', 'refund', 'fee', 'pending', 'booking_pending', 'booking_completed', 'withdrawal_approved', 'withdrawal_requested')),
                status VARCHAR(50) DEFAULT 'completed',
                reference_id CHAR(36),
                description VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wallet_id) REFERENCES wallets(user_id)
            )
        `);
        console.log('✅ Wallet transactions table created/verified');

        // 3. Create bank_accounts table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS bank_accounts (
                id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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

        // 4. Create withdrawals table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
                user_id CHAR(36) NOT NULL,
                bank_account_id CHAR(36) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'failed')),
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP NULL,
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

        // 5. Update payments table to include carrier_amount and escort_amount
        const [paymentColumns] = await connection.query(`SHOW COLUMNS FROM payments`);
        const columnNames = paymentColumns.map(c => c.Field);

        if (!columnNames.includes('carrier_amount')) {
            await connection.query(`ALTER TABLE payments ADD COLUMN carrier_amount DECIMAL(12,2) DEFAULT 0.00 AFTER amount`);
            console.log('Added carrier_amount to payments');
        }
        if (!columnNames.includes('escort_amount')) {
            await connection.query(`ALTER TABLE payments ADD COLUMN escort_amount DECIMAL(12,2) DEFAULT 0.00 AFTER carrier_amount`);
            console.log('Added escort_amount to payments');
        }

        // 6. Ensure all users have a wallet
        await connection.query(`
            INSERT IGNORE INTO wallets (user_id, balance, pending_balance, currency)
            SELECT id, 0.00, 0.00, 'USD' FROM users
        `);
        console.log('✅ Ensured all users have wallets');

        await connection.commit();
        console.log('✅ Setup completed successfully!');

    } catch (error) {
        await connection.rollback();
        console.error('❌ Setup failed:', error);
        throw error;
    } finally {
        connection.release();
        await pool.end();
    }
}

setupFullWalletSystem();
