const { pool } = require('./config/database');

async function setupNotifications() {
    try {
        console.log('Setting up notifications table...');

        // Create notifications table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
                user_id CHAR(36) NOT NULL,
                type ENUM('booking', 'message', 'quote', 'quote_accepted', 'booking_update', 'payment', 'review', 'system') NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                link VARCHAR(500),
                is_read BOOLEAN DEFAULT FALSE,
                metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_read (user_id, is_read),
                INDEX idx_created (created_at)
            )
        `);

        console.log('✅ Notifications table created successfully.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error setting up notifications:', error);
        process.exit(1);
    }
}

setupNotifications();
