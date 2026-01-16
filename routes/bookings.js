const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// @route   POST /api/bookings
// @desc    Create a new booking
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    try {
        const shipper_id = req.user.id;
        const id = uuidv4();
        const {
            pickupAddress,
            pickupCity,
            pickupState,
            deliveryAddress,
            deliveryCity,
            deliveryState,
            cargoType,
            cargoDescription,
            length,
            width,
            height,
            weight,
            shipmentDate,
            flexibleDates,
            requiresEscort,
            specialInstructions
        } = req.body;

        // Basic validation
        if (!pickupAddress || !pickupCity || !pickupState || !deliveryAddress || !deliveryCity || !deliveryState || !cargoType || !cargoDescription || !length || !width || !height || !weight || !shipmentDate) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const query = `
            INSERT INTO bookings (
                id,
                shipper_id,
                pickup_address,
                pickup_city,
                pickup_state,
                delivery_address,
                delivery_city,
                delivery_state,
                cargo_type,
                cargo_description,
                dimensions_length_ft,
                dimensions_width_ft,
                dimensions_height_ft,
                weight_lbs,
                shipment_date,
                flexible_dates,
                requires_escort,
                special_instructions,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            id,
            shipper_id,
            pickupAddress,
            pickupCity,
            pickupState,
            deliveryAddress,
            deliveryCity,
            deliveryState,
            cargoType,
            cargoDescription,
            parseFloat(length),
            parseFloat(width),
            parseFloat(height),
            parseFloat(weight),
            shipmentDate,
            flexibleDates ? 1 : 0,
            requiresEscort ? 1 : 0,
            specialInstructions || null,
            'pending_quote'
        ];

        await pool.query(query, params);

        res.status(201).json({
            success: true,
            message: 'Booking request submitted successfully',
            data: {
                id,
                shipper_id,
                status: 'pending_quote'
            }
        });
    } catch (error) {
        console.error('Booking creation error:', error);
        res.status(500).json({ success: false, message: 'Server error creating booking' });
    }
});

// @route   GET /api/bookings/my-bookings
// @desc    Get bookings for the logged-in user
// @access  Private
router.get('/my-bookings', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        let query = 'SELECT * FROM bookings WHERE ';
        let params = [];

        if (userRole === 'shipper') {
            query += 'shipper_id = ?';
            params.push(userId);
        } else if (userRole === 'carrier') {
            query += 'carrier_id = ?';
            params.push(userId);
        } else if (userRole === 'escort') {
            query += 'escort_id = ?';
            params.push(userId);
        } else if (userRole === 'driver') {
            query += 'assigned_driver_id = ?';
            params.push(userId);
        } else if (userRole === 'admin') {
            query = 'SELECT * FROM bookings';
            params = [];
        } else {
            return res.status(403).json({ success: false, message: 'Unauthorized role' });
        }

        query += ' ORDER BY created_at DESC';

        const [bookings] = await pool.query(query, params);

        res.json({ success: true, data: bookings });
    } catch (error) {
        console.error('Fetch bookings error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching bookings' });
    }
});

// @route   DELETE /api/bookings/:id
// @desc    Delete a booking (if no quotes exist)
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const shipper_id = req.user.id;

        // Check if booking exists and belongs to the shipper
        const [booking] = await pool.query('SELECT * FROM bookings WHERE id = ? AND shipper_id = ?', [id, shipper_id]);
        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found or unauthorized' });
        }

        // Check if any quotes exist
        const [quotes] = await pool.query('SELECT id FROM quotes WHERE booking_id = ?', [id]);
        if (quotes.length > 0) {
            return res.status(400).json({ success: false, message: 'Cannot delete booking after quotes have been submitted' });
        }

        await pool.query('DELETE FROM bookings WHERE id = ?', [id]);
        res.json({ success: true, message: 'Booking deleted successfully' });
    } catch (error) {
        console.error('Booking deletion error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting booking' });
    }
});

// @route   PUT /api/bookings/:id
// @desc    Update a booking (if no quotes exist)
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const shipper_id = req.user.id;
        const {
            pickupAddress,
            pickupCity,
            pickupState,
            deliveryAddress,
            deliveryCity,
            deliveryState,
            cargoType,
            cargoDescription,
            length,
            width,
            height,
            weight,
            shipmentDate,
            flexibleDates,
            requiresEscort,
            specialInstructions
        } = req.body;

        // Check if booking exists and belongs to the shipper
        const [booking] = await pool.query('SELECT * FROM bookings WHERE id = ? AND shipper_id = ?', [id, shipper_id]);
        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found or unauthorized' });
        }

        // Check if any quotes exist
        const [quotes] = await pool.query('SELECT id FROM quotes WHERE booking_id = ?', [id]);
        if (quotes.length > 0) {
            return res.status(400).json({ success: false, message: 'Cannot edit booking after quotes have been submitted' });
        }

        const query = `
            UPDATE bookings SET 
                pickup_address=?, pickup_city=?, pickup_state=?,
                delivery_address=?, delivery_city=?, delivery_state=?,
                cargo_type=?, cargo_description=?,
                dimensions_length_ft=?, dimensions_width_ft=?, dimensions_height_ft=?, weight_lbs=?,
                shipment_date=?, flexible_dates=?, requires_escort=?, special_instructions=?
            WHERE id = ?
        `;

        const params = [
            pickupAddress, pickupCity, pickupState,
            deliveryAddress, deliveryCity, deliveryState,
            cargoType, cargoDescription,
            parseFloat(length), parseFloat(width), parseFloat(height), parseFloat(weight),
            shipmentDate, flexibleDates ? 1 : 0, requiresEscort ? 1 : 0, specialInstructions || null,
            id
        ];

        await pool.query(query, params);
        res.json({ success: true, message: 'Booking updated successfully' });
    } catch (error) {
        console.error('Booking update error:', error);
        res.status(500).json({ success: false, message: 'Server error updating booking' });
    }
});

module.exports = router;
