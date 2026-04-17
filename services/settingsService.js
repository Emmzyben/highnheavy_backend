const { pool } = require('../config/database');

/**
 * Get a setting value by ID
 * @param {string} id - The setting ID
 * @param {string} defaultValue - The default value if not found
 * @returns {Promise<string>}
 */
async function getSetting(id, defaultValue = null) {
    try {
        const [rows] = await pool.query('SELECT value FROM settings WHERE id = ?', [id]);
        if (rows.length > 0) {
            return rows[0].value;
        }
        return defaultValue;
    } catch (error) {
        console.error(`Error getting setting ${id}:`, error);
        return defaultValue;
    }
}

/**
 * Update a setting value
 * @param {string} id - The setting ID
 * @param {string} value - The new value
 * @returns {Promise<boolean>}
 */
async function updateSetting(id, value) {
    try {
        await pool.query('UPDATE settings SET value = ? WHERE id = ?', [value, id]);
        return true;
    } catch (error) {
        console.error(`Error updating setting ${id}:`, error);
        return false;
    }
}

/**
 * Get platform fee percentage as a decimal (e.g. 15 becomes 0.15)
 * @returns {Promise<number>}
 */
async function getPlatformFeePercentage() {
    const value = await getSetting('platform_fee_percentage', '15');
    return parseFloat(value) / 100;
}

module.exports = {
    getSetting,
    updateSetting,
    getPlatformFeePercentage
};
