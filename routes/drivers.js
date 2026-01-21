const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// @route   GET /api/drivers
// @desc    Get all drivers for the logged-in carrier
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const carrierId = req.user.id;

        // Verify user is a carrier
        if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query(
            'SELECT * FROM drivers WHERE employer_id = ? ORDER BY name ASC',
            [carrierId]
        );

        res.json({
            success: true,
            data: drivers
        });
    } catch (error) {
        console.error('Fetch drivers error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching drivers' });
    }
});

// @route   POST /api/drivers
// @desc    Add a new driver
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const carrierId = req.user.id;
        const { name, email, phone, license, licenseExpiry, password } = req.body;

        if (req.user.role !== 'carrier') {
            return res.status(403).json({ success: false, message: 'Only carriers can add drivers' });
        }

        if (!name || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        await connection.beginTransaction();

        // 1. Check if user already exists
        const [existingUser] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'A user with this email already exists' });
        }

        // 2. Create user account for driver
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const userId = uuidv4();

        await connection.query(
            'INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
            [userId, email, password_hash, name, 'driver']
        );

        // 3. Create driver profile
        const driverId = uuidv4();
        await connection.query(
            'INSERT INTO drivers (id, user_id, employer_id, name, email, phone, license_number, license_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [driverId, userId, carrierId, name, email, phone, license, licenseExpiry || null]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Driver added successfully',
            data: { id: driverId, userId, name, email }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Add driver error:', error);
        res.status(500).json({ success: false, message: 'Server error adding driver' });
    } finally {
        connection.release();
    }
});

// @route   PUT /api/drivers/:id
// @desc    Update a driver
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const carrierId = req.user.id;
        const { name, email, phone, license, licenseExpiry, status } = req.body;

        // Check if driver belongs to this carrier
        const [existingDriver] = await pool.query(
            'SELECT * FROM drivers WHERE id = ? AND employer_id = ?',
            [id, carrierId]
        );

        if (existingDriver.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found or unauthorized' });
        }

        await pool.query(
            'UPDATE drivers SET name = ?, email = ?, phone = ?, license_number = ?, license_expiry = ?, status = ? WHERE id = ?',
            [name, email, phone, license, licenseExpiry || null, status || existingDriver[0].status, id]
        );

        // Also update users table if email or name changed
        if (existingDriver[0].user_id) {
            await pool.query(
                'UPDATE users SET full_name = ?, email = ? WHERE id = ?',
                [name, email, existingDriver[0].user_id]
            );
        }

        res.json({
            success: true,
            message: 'Driver updated successfully'
        });
    } catch (error) {
        console.error('Update driver error:', error);
        res.status(500).json({ success: false, message: 'Server error updating driver' });
    }
});

// @route   DELETE /api/drivers/:id
// @desc    Delete a driver
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const carrierId = req.user.id;

        // Check if driver belongs to this carrier
        const [existingDriver] = await connection.query(
            'SELECT * FROM drivers WHERE id = ? AND employer_id = ?',
            [id, carrierId]
        );

        if (existingDriver.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Driver not found or unauthorized' });
        }

        await connection.beginTransaction();

        const userId = existingDriver[0].user_id;

        // Delete driver profile
        await connection.query('DELETE FROM drivers WHERE id = ?', [id]);

        // Delete user account
        if (userId) {
            await connection.query('DELETE FROM users WHERE id = ?', [userId]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Driver deleted successfully'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Delete driver error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting driver' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/drivers/provider/:providerId
// @desc    Get all drivers for a specific carrier
// @access  Private (Admin or Shipper)
router.get('/provider/:providerId', authMiddleware, async (req, res) => {
    try {
        const { providerId } = req.params;
        const [drivers] = await pool.query(
            'SELECT * FROM drivers WHERE employer_id = ? ORDER BY name ASC',
            [providerId]
        );
        res.json({ success: true, data: drivers });
    } catch (error) {
        console.error('Fetch provider drivers error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
