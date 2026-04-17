const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// @route   GET /api/cargo-types
// @desc    Get all cargo types
// @access  Public
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cargo_types ORDER BY name ASC');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching cargo types:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/cargo-types
// @desc    Add a new cargo type
// @access  Private (Admin only)
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        const [result] = await pool.query(
            'INSERT INTO cargo_types (name, description) VALUES (?, ?)',
            [name, description || '']
        );

        res.json({
            success: true,
            data: { id: result.insertId, name, description }
        });
    } catch (error) {
        console.error('Error adding cargo type:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Cargo type already exists' });
        }
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   PUT /api/cargo-types/:id
// @desc    Update a cargo type
// @access  Private (Admin only)
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        await pool.query(
            'UPDATE cargo_types SET name = ?, description = ? WHERE id = ?',
            [name, description || '', id]
        );

        res.json({ success: true, message: 'Cargo type updated' });
    } catch (error) {
        console.error('Error updating cargo type:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/cargo-types/:id
// @desc    Delete a cargo type
// @access  Private (Admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        await pool.query('DELETE FROM cargo_types WHERE id = ?', [id]);
        res.json({ success: true, message: 'Cargo type deleted' });
    } catch (error) {
        console.error('Error deleting cargo type:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
