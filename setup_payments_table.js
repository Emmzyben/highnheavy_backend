const { pool } = require('./config/database');

async function setupPaymentsTable() {
    const connection = await pool.getConnection();
    try {
        console.log('Setting up payments table and updating booking status...');

        await connection.beginTransaction();

        // Create payments table if it doesn't exist
        await connection.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id CHAR(36) PRIMARY KEY,
                booking_id CHAR(36),
                invoice_id CHAR(36),
                payer_id CHAR(36) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                platform_fee DECIMAL(12,2) DEFAULT 0.00,
                total_amount DECIMAL(12,2) NOT NULL,
                method VARCHAR(50) NOT NULL,
                transaction_ref VARCHAR(100),
                status VARCHAR(50) DEFAULT 'pending',
                metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
                FOREIGN KEY (payer_id) REFERENCES users(id)
            )
        `);
        console.log('✅ Payments table created/verified');

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

// Run the setup
setupPaymentsTable()
    .then(() => {
        console.log('Setup script finished');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Setup script failed:', error);
        process.exit(1);
    });
