const { pool } = require('./config/database');
const fs = require('fs');

async function checkSchema() {
    try {
        const [rows] = await pool.query('SHOW CREATE TABLE bookings');
        const schema = rows[0]['Create Table'];
        fs.writeFileSync('schema_dump.txt', schema);
        console.log('Schema dumped to schema_dump.txt');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkSchema();
