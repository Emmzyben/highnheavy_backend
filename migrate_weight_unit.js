const { pool } = require('./config/database');

const alterTable = async () => {
    try {
        // Check if column exists first
        const [rows] = await pool.query("SHOW COLUMNS FROM bookings LIKE 'weight_unit'");
        if (rows.length > 0) {
            console.log('✅ Column already exists');
            process.exit(0);
        }
        
        const query = "ALTER TABLE bookings ADD COLUMN weight_unit VARCHAR(10) DEFAULT 'lbs' AFTER weight_lbs";
        await pool.query(query);
        console.log('✅ Alter Table Successful: added weight_unit column');
        process.exit(0);
    } catch (error) {
        console.error('❌ Alter Table Failed:', error.message);
        process.exit(1);
    }
};

alterTable();
