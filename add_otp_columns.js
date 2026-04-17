const { pool } = require('./config/database');

const addOtpColumns = async () => {
    try {
        console.log('--- Adding OTP columns to users table ---');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6) NULL DEFAULT NULL');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP NULL DEFAULT NULL');
        console.log('✅ OTP columns added successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error adding OTP columns:', error.message);
        process.exit(1);
    }
};

addOtpColumns();
