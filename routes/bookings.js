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
            console.log('DEBUG: Missing fields in booking:', {
                pickupAddress: !!pickupAddress, pickupCity: !!pickupCity, pickupState: !!pickupState,
                deliveryAddress: !!deliveryAddress, deliveryCity: !!deliveryCity, deliveryState: !!deliveryState,
                cargoType: !!cargoType, cargoDescription: !!cargoDescription,
                length: !!length, width: !!width, height: !!height, weight: !!weight, shipmentDate: !!shipmentDate
            });
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
                       d.name as driver_name,
                       r.id as review_id,
                       r.rating as review_rating,
                       r.comment as review_comment
                FROM bookings b
                LEFT JOIN users cu ON b.carrier_id = cu.id
                LEFT JOIN profiles cp ON b.carrier_id = cp.user_id
                LEFT JOIN users eu ON b.escort_id = eu.id
                LEFT JOIN profiles ep ON b.escort_id = ep.user_id
                LEFT JOIN drivers d ON b.assigned_driver_id = d.id
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
            const [driverRecord] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
            if (driverRecord.length === 0) {
                return res.json({ success: true, data: [] });
            }
            query += 'assigned_driver_id = ?';
            params.push(driverRecord[0].id);
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

// @route   GET /api/bookings/:id
// @desc    Get a single booking by ID
// @access  Private
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        // Base query to get booking details with shipper info
        let query = `
            SELECT b.*, 
                   u.full_name as shipper_name, 
                   p.company_name as shipper_company,
                   u_c.full_name as carrier_name,
                   u_e.full_name as escort_name,
                   d.name as driver_name,
                   d.phone as driver_phone
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            LEFT JOIN users u_c ON b.carrier_id = u_c.id
            LEFT JOIN users u_e ON b.escort_id = u_e.id
            LEFT JOIN drivers d ON b.assigned_driver_id = d.id
            WHERE b.id = ?
        `;

        const [results] = await pool.query(query, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const booking = results[0];

        // Access Control Logic
        let hasAccess = false;

        if (userRole === 'admin') {
            hasAccess = true;
        } else if (userRole === 'shipper' && booking.shipper_id === userId) {
            hasAccess = true;
        } else if (userRole === 'carrier') {
            // Carriers can see bookings they are assigned to OR bookings that are available for quoting
            if (booking.carrier_id === userId) {
                hasAccess = true;
            } else if (booking.carrier_id === null && ['pending_quote', 'quoted'].includes(booking.status)) {
                hasAccess = true;
            }
            // Also allow if they have submitted a quote (even if it's not 'available' anymore)
            const [quote] = await pool.query('SELECT id FROM quotes WHERE booking_id = ? AND provider_id = ?', [id, userId]);
            if (quote.length > 0) hasAccess = true;
        } else if (userRole === 'escort') {
            // Escorts can see bookings they are assigned to OR bookings that need escort and are available
            if (booking.escort_id === userId) {
                hasAccess = true;
            } else if (booking.requires_escort === 1 && booking.escort_id === null) {
                hasAccess = true;
            }
            const [quote] = await pool.query('SELECT id FROM quotes WHERE booking_id = ? AND provider_id = ?', [id, userId]);
            if (quote.length > 0) hasAccess = true;
        } else if (userRole === 'driver') {
            const [driverRecord] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
            if (driverRecord.length > 0 && booking.assigned_driver_id === driverRecord[0].id) {
                hasAccess = true;
            }
        }

        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Unauthorized to view this booking' });
        }

        res.json({ success: true, data: booking });
    } catch (error) {
        console.error('Fetch single booking error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching booking' });
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

        const allowedStatuses = ['awaiting_payment', 'in_transit', 'delivered', 'completed', 'cancelled', 'booked'];
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
        const isShipper = userRole === 'shipper' && b.shipper_id === userId;

        // Fix Driver check: compare driver.id (not user.id) with booking.assigned_driver_id
        let isDriver = false;
        if (userRole === 'driver') {
            const [driverRecord] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
            if (driverRecord.length > 0 && b.assigned_driver_id === driverRecord[0].id) {
                isDriver = true;
            }
        }

        if (!isAdmin && !isCarrier && !isEscort && !isDriver && !isShipper) {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this booking' });
        }

        // Enforce status transition rules
        if (isShipper && !isAdmin) {
            if (status !== 'completed') {
                return res.status(400).json({ success: false, message: 'Shippers can only mark bookings as completed' });
            }
            if (b.status !== 'delivered') {
                return res.status(400).json({ success: false, message: 'Booking must be delivered before it can be marked as completed' });
            }
        }

        if (isDriver && !isAdmin) {
            const allowedDriverStatuses = ['in_transit', 'delivered'];
            if (!allowedDriverStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Drivers can only update status to in_transit or delivered' });
            }
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Update booking status
            await connection.query('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);

            // If status is completed, release funds
            if (status === 'completed' && b.status !== 'completed') {
                // Get payment details to know how much to release
                const [payments] = await connection.query(
                    'SELECT carrier_amount, escort_amount FROM payments WHERE booking_id = ? AND status = "completed" LIMIT 1',
                    [id]
                );

                if (payments.length > 0) {
                    const { carrier_amount, escort_amount } = payments[0];

                    // Release Carrier Funds
                    if (b.carrier_id && carrier_amount > 0) {
                        await connection.query(
                            'UPDATE wallets SET balance = balance + ?, pending_balance = pending_balance - ? WHERE user_id = ?',
                            [carrier_amount, carrier_amount, b.carrier_id]
                        );
                        await connection.query(`
                            INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                            VALUES (?, ?, 'booking_completed', 'completed', ?, ?)
                        `, [b.carrier_id, carrier_amount, id, `Funds released for completed booking ${id}`]);
                    }

                    // Release Escort Funds
                    if (b.escort_id && escort_amount > 0) {
                        await connection.query(
                            'UPDATE wallets SET balance = balance + ?, pending_balance = pending_balance - ? WHERE user_id = ?',
                            [escort_amount, escort_amount, b.escort_id]
                        );
                        await connection.query(`
                            INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                            VALUES (?, ?, 'booking_completed', 'completed', ?, ?)
                        `, [b.escort_id, escort_amount, id, `Escort funds released for completed booking ${id}`]);
                    }
                }
            }

            await connection.commit();
            res.json({ success: true, message: `Booking status updated to ${status}` });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ success: false, message: 'Server error updating booking status' });
    }
});

module.exports = router;
