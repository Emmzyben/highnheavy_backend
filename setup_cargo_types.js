const { pool } = require('./config/database');

const setupCargoTypes = async () => {
    try {
        console.log('--- Setting up Cargo Types Table ---');

        // Create cargo_types table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cargo_types (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
        `);
        console.log('✅ cargo_types table created or already exists.');

        // Insert initial cargo types if the table is empty
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM cargo_types');
        if (rows[0].count === 0) {
            const initialTypes = [
                ['Construction Equipment', 'Heavy machinery used in construction like excavators, loaders, etc.'],
                ['Industrial Machinery', 'Large-scale manufacturing and industrial equipment.'],
                ['Agricultural Equipment', 'Farming machinery like tractors, harvesters, etc.'],
                ['Pre-Fab Buildings/Modules', 'Prefabricated structures or building modules.'],
                ['Wind Energy Components', 'Wind turbine blades, nacelles, and towers.'],
                ['Mining Equipment', 'Large-scale equipment for mining operations.'],
                ['Other', 'Miscellaneous cargo types.']
            ];

            await pool.query(
                'INSERT INTO cargo_types (name, description) VALUES ?',
                [initialTypes]
            );
            console.log('✅ Initial cargo types inserted.');
        } else {
            console.log('ℹ️ cargo_types table already has data, skipping initial insert.');
        }

        console.log('--- Cargo Types Setup Complete ---');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error setting up cargo types:', error.message);
        process.exit(1);
    }
};

setupCargoTypes();
