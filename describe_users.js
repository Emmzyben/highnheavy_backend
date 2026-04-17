const { pool } = require('./config/database');

const checkUsersTable = async () => {
    try {
        const [rows] = await pool.query('DESCRIBE users');
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkUsersTable();
