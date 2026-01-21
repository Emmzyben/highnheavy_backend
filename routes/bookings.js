const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('./notifications');

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

        // Notify all admins about new booking
        const [admins] = await pool.query('SELECT id FROM users WHERE role = "admin"');
        for (const admin of admins) {
            await createNotification({
                userId: admin.id,
                type: 'booking',
                title: 'New Booking Request',
                message: `New ${cargoType} booking from ${pickupCity}, ${pickupState} to ${deliveryCity}, ${deliveryState}`,
                link: '/dashboard/admin?section=bookings',
                metadata: { bookingId: id }
            });
        }

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
            query = `
                SELECT b.*, 
                       cu.full_name as carrier_name, 
                       cp.company_name as carrier_company,
                       eu.full_name as escort_name, 
                       ep.company_name as escort_company,
                       r.id as review_id,
                       r.rating as review_rating,
                       r.comment as review_comment
                FROM bookings b
                LEFT JOIN users cu ON b.carrier_id = cu.id
                LEFT JOIN profiles cp ON b.carrier_id = cp.user_id
                LEFT JOIN users eu ON b.escort_id = eu.id
                LEFT JOIN profiles ep ON b.escort_id = ep.user_id
                LEFT JOIN reviews r ON b.id = r.booking_id AND r.reviewer_id = ?
                WHERE b.shipper_id = ?
            `;
            params.push(userId, userId);
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
            query = `
                SELECT b.*, 
                       u.full_name as shipper_name, 
                       p.company_name as shipper_company
                FROM bookings b
                LEFT JOIN users u ON b.shipper_id = u.id
                LEFT JOIN profiles p ON b.shipper_id = p.user_id
            `;
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

// @route   PATCH /api/bookings/:id/status
// @desc    Update booking status
// @access  Private
router.patch('/:id/status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        const allowedStatuses = ['in_transit', 'delivered', 'completed', 'cancelled', 'booked'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        // Check if user is authorized to update this booking
        const [booking] = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const b = booking[0];
        const isAdmin = userRole === 'admin';
        const isCarrier = userRole === 'carrier' && b.carrier_id === userId;
        const isEscort = userRole === 'escort' && b.escort_id === userId;
        const isDriver = userRole === 'driver' && b.assigned_driver_id === userId;

        if (!isAdmin && !isCarrier && !isEscort && !isDriver) {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this booking' });
        }

        await pool.query('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);

        res.json({ success: true, message: `Booking status updated to ${status}` });
    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ success: false, message: 'Server error updating booking status' });
    }
});

module.exports = router;
