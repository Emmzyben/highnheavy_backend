const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// @route   GET /api/vehicles
// @desc    Get all vehicles for the carrier
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const ownerId = req.user.id;
        const [vehicles] = await pool.query(
            'SELECT * FROM vehicles WHERE owner_id = ? ORDER BY created_at DESC',
            [ownerId]
        );
        res.json({ success: true, data: vehicles });
    } catch (error) {
        console.error('Fetch vehicles error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching vehicles' });
    }
});

// @route   POST /api/vehicles
// @desc    Add a new vehicle
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { type, name, plate_number, vin, year, capacity, dimensions, status, last_inspection, photos } = req.body;

        if (!type || !name) {
            return res.status(400).json({ success: false, message: 'Type and Name are required' });
        }

        const id = uuidv4();
        await pool.query(
            `INSERT INTO vehicles 
            (id, owner_id, type, name, plate_number, vin, year, capacity, dimensions, status, last_inspection, photos) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                ownerId,
                type,
                name,
                plate_number,
                vin,
                year,
                capacity,
                dimensions,
                status || 'available',
                last_inspection || null,
                JSON.stringify(photos || [])
            ]
        );

        res.status(201).json({ success: true, message: 'Vehicle added successfully', data: { id } });
    } catch (error) {
        console.error('Add vehicle error:', error);
        res.status(500).json({ success: false, message: 'Server error adding vehicle' });
    }
});

// @route   PUT /api/vehicles/:id
// @desc    Update a vehicle
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { id } = req.params;
        const { type, name, plate_number, vin, year, capacity, dimensions, status, last_inspection, photos } = req.body;

        // Verify ownership
        const [existing] = await pool.query('SELECT owner_id FROM vehicles WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Vehicle not found' });
        }
        if (existing[0].owner_id !== ownerId) {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this vehicle' });
        }

        await pool.query(
            `UPDATE vehicles 
             SET type = ?, name = ?, plate_number = ?, vin = ?, year = ?, capacity = ?, dimensions = ?, status = ?, last_inspection = ?, photos = ?
             WHERE id = ?`,
            [
                type,
                name,
                plate_number,
                vin,
                year,
                capacity,
                dimensions,
                status,
                last_inspection,
                JSON.stringify(photos || []),
                id
            ]
        );

        res.json({ success: true, message: 'Vehicle updated successfully' });
    } catch (error) {
        console.error('Update vehicle error:', error);
        res.status(500).json({ success: false, message: 'Server error updating vehicle' });
    }
});

// @route   DELETE /api/vehicles/:id
// @desc    Delete a vehicle
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { id } = req.params;

        // Verify ownership
        const [existing] = await pool.query('SELECT owner_id FROM vehicles WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Vehicle not found' });
        }
        if (existing[0].owner_id !== ownerId) {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this vehicle' });
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Nullify references in quotes table before deleting
            await connection.query('UPDATE quotes SET vehicle_id = NULL WHERE vehicle_id = ?', [id]);

            // Delete vehicle
            await connection.query('DELETE FROM vehicles WHERE id = ?', [id]);

            await connection.commit();
            res.json({ success: true, message: 'Vehicle deleted successfully' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Delete vehicle error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting vehicle' });
    }
});

// @route   GET /api/vehicles/provider/:providerId
// @desc    Get all vehicles for a specific provider
// @access  Private (Admin or Shipper)
router.get('/provider/:providerId', authMiddleware, async (req, res) => {
    try {
        const { providerId } = req.params;
        const [vehicles] = await pool.query(
            'SELECT * FROM vehicles WHERE owner_id = ? ORDER BY created_at DESC',
            [providerId]
        );
        res.json({ success: true, data: vehicles });
    } catch (error) {
        console.error('Fetch provider vehicles error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
