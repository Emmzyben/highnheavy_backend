const { pool } = require('./config/database');

async function setup() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
                booking_id CHAR(36) NOT NULL,
                reviewer_id CHAR(36) NOT NULL,
                subject_id CHAR(36) NOT NULL,
                rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(id),
                FOREIGN KEY (reviewer_id) REFERENCES users(id),
                FOREIGN KEY (subject_id) REFERENCES users(id)
            )
        `);
        console.log('Reviews table created successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error creating reviews table:', error);
        process.exit(1);
    }
}

setup();
