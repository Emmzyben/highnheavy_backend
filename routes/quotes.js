const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('./notifications');

// @route   GET /api/quotes/all-admin
// @desc    Get all quotes (Admin Only)
// @access  Private
router.get('/all-admin', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
        }

        const [quotes] = await pool.query(`
            SELECT q.*, 
                   u_p.full_name as carrier_name, 
                   p_p.company_name as carrier_company,
                   u_s.full_name as shipper_name,
                   b.cargo_type, b.pickup_city, b.pickup_state, b.delivery_city, b.delivery_state, b.shipment_date,
                   u_p.role as provider_role
            FROM quotes q
            JOIN users u_p ON q.provider_id = u_p.id
            LEFT JOIN profiles p_p ON q.provider_id = p_p.user_id
            JOIN bookings b ON q.booking_id = b.id
            JOIN users u_s ON b.shipper_id = u_s.id
            ORDER BY q.created_at DESC
        `);

        res.json({ success: true, data: quotes });
    } catch (error) {
        console.error('Fetch all quotes error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching quotes' });
    }
});

// @route   GET /api/quotes/available
// @desc    Get bookings that are available for quoting
// @access  Private (Carrier only)
router.get('/available', authMiddleware, async (req, res) => {
    try {
        const providerId = req.user.id;
        const role = req.user.role;

        let availableBookings;
        if (role === 'escort') {
            [availableBookings] = await pool.query(`
                SELECT b.*, u.full_name as shipper_name 
                FROM bookings b
                JOIN users u ON b.shipper_id = u.id
                WHERE b.requires_escort = 1 
                AND b.escort_id IS NULL 
                AND b.status IN ('pending_quote', 'quoted', 'booked')
                AND b.id NOT IN (SELECT booking_id FROM quotes WHERE provider_id = ?)
                ORDER BY b.created_at DESC
            `, [providerId]);
        } else {
            [availableBookings] = await pool.query(`
                SELECT b.*, u.full_name as shipper_name 
                FROM bookings b
                JOIN users u ON b.shipper_id = u.id
                WHERE b.carrier_id IS NULL 
                AND b.status IN ('pending_quote', 'quoted')
                AND b.id NOT IN (SELECT booking_id FROM quotes WHERE provider_id = ?)
                ORDER BY b.created_at DESC
            `, [providerId]);
        }

        res.json({
            success: true,
            data: availableBookings
        });
    } catch (error) {
        console.error('Fetch available bookings error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching available bookings' });
    }
});

// @route   GET /api/quotes/my-quotes
// @desc    Get bookings where the carrier has submitted a quote
// @access  Private (Carrier only)
router.get('/my-quotes', authMiddleware, async (req, res) => {
    try {
        const providerId = req.user.id;

        const [myQuotes] = await pool.query(`
            SELECT q.*, b.*, q.id as quote_id, q.status as quote_status, u.full_name as shipper_name
            FROM quotes q
            JOIN bookings b ON q.booking_id = b.id
            JOIN users u ON b.shipper_id = u.id
            WHERE q.provider_id = ?
            ORDER BY q.created_at DESC
        `, [providerId]);

        res.json({
            success: true,
            data: myQuotes
        });
    } catch (error) {
        console.error('Fetch my quotes error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching my quotes' });
    }
});

// @route   GET /api/quotes/won-jobs
// @desc    Get bookings where the carrier has been assigned
// @access  Private (Carrier only)
router.get('/won-jobs', authMiddleware, async (req, res) => {
    try {
        const providerId = req.user.id;
        const role = req.user.role;

        let wonJobs;
        if (role === 'escort') {
            [wonJobs] = await pool.query(`
                SELECT b.*, u.full_name as shipper_name
                FROM bookings b
                JOIN users u ON b.shipper_id = u.id
                WHERE b.escort_id = ?
                ORDER BY b.updated_at DESC
            `, [providerId]);
        } else {
            [wonJobs] = await pool.query(`
                SELECT b.*, u.full_name as shipper_name
                FROM bookings b
                JOIN users u ON b.shipper_id = u.id
                WHERE b.carrier_id = ?
                ORDER BY b.updated_at DESC
            `, [providerId]);
        }

        res.json({
            success: true,
            data: wonJobs
        });
    } catch (error) {
        console.error('Fetch won jobs error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching won jobs' });
    }
});

// @route   POST /api/quotes
// @desc    Submit a quote for a booking
// @access  Private (Carrier or Escort)
router.post('/', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const providerId = req.user.id;
        const role = req.user.role;
        const { booking_id, amount, driver_id, vehicle_id, notes } = req.body;

        if (!booking_id || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        await connection.beginTransaction();

        // 1. Check if booking exists and is available
        const [booking] = await connection.query('SELECT status, carrier_id, escort_id, requires_escort FROM bookings WHERE id = ?', [booking_id]);
        if (booking.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const b = booking[0];

        if (role === 'escort') {
            if (!booking_id || !amount || !vehicle_id || !notes) {
                return res.status(400).json({ success: false, message: 'Missing required fields: Amount, Vehicle, and Notes are mandatory' });
            }
            if (b.requires_escort !== 1) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'This booking does not require an escort' });
            }
            if (b.escort_id) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Escort already assigned to this booking' });
            }
        } else if (role === 'carrier') {
            if (!booking_id || !amount || !driver_id || !vehicle_id || !notes) {
                return res.status(400).json({ success: false, message: 'Missing required fields: Amount, Driver, Vehicle, and Notes are mandatory' });
            }
            if (b.carrier_id) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Carrier already assigned to this booking' });
            }
        } else {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Only carriers and escorts can submit quotes' });
        }

        // 2. Check if provider already quoted
        const [existingQuote] = await connection.query('SELECT id FROM quotes WHERE booking_id = ? AND provider_id = ?', [booking_id, providerId]);
        if (existingQuote.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'You have already submitted a quote for this booking' });
        }

        // 3. Create quote
        const quoteId = uuidv4();
        await connection.query(`
            INSERT INTO quotes (id, booking_id, provider_id, amount, driver_id, vehicle_id, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [quoteId, booking_id, providerId, amount, driver_id || null, vehicle_id || null, notes]);

        // 4. Update booking status to 'quoted' if it was 'pending_quote'
        if (b.status === 'pending_quote') {
            await connection.query('UPDATE bookings SET status = "quoted" WHERE id = ?', [booking_id]);
        }

        await connection.commit();

        // Notify all admins about new quote
        // Notify all admins about new quote
        const [admins] = await pool.query('SELECT id FROM users WHERE role = "admin"');
        const [bookingData] = await pool.query('SELECT cargo_type, pickup_city, pickup_state FROM bookings WHERE id = ?', [booking_id]);
        const bookingInfo = bookingData[0];

        for (const admin of admins) {
            await createNotification({
                userId: admin.id,
                type: 'quote',
                title: `New Quote from ${role.charAt(0).toUpperCase() + role.slice(1)}`,
                message: `$${amount} quote received for ${bookingInfo.cargo_type} from ${bookingInfo.pickup_city}, ${bookingInfo.pickup_state}`,
                link: '/dashboard/admin?section=quotes',
                metadata: { quoteId, bookingId: booking_id, providerId }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Quote submitted successfully',
            data: { id: quoteId }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Submit quote error:', error);
        res.status(500).json({ success: false, message: 'Server error submitting quote' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/quotes/booking/:bookingId
// @desc    Get all quotes for a specific booking
// @access  Private (Shipper of the booking or Admin)
router.get('/booking/:bookingId', authMiddleware, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.id;

        // Verify if user is the shipper of this booking or an admin
        const [booking] = await pool.query('SELECT shipper_id FROM bookings WHERE id = ?', [bookingId]);

        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking[0].shipper_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to view these quotes' });
        }

        const [quotes] = await pool.query(`
            SELECT q.*, u.full_name as carrier_name, u.role, p.company_name, d.name as driver_name, v.name as vehicle_name
            FROM quotes q
            JOIN users u ON q.provider_id = u.id
            LEFT JOIN profiles p ON u.id = p.user_id
            LEFT JOIN drivers d ON q.driver_id = d.id
            LEFT JOIN vehicles v ON q.vehicle_id = v.id
            WHERE q.booking_id = ?
            ORDER BY q.amount ASC
        `, [bookingId]);

        res.json({
            success: true,
            data: quotes
        });
    } catch (error) {
        console.error('Fetch booking quotes error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching quotes' });
    }
});

// @route   PUT /api/quotes/:id/accept
// @desc    Accept a quote and link carrier/escort/driver to booking
// @access  Private (Admin Only)
router.put('/:id/accept', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const quoteId = req.params.id;

        await connection.beginTransaction();

        // 1. Get quote details with provider role
        const [quoteDetails] = await connection.query(`
            SELECT q.*, u.role as provider_role, b.id as booking_id, b.requires_escort, b.carrier_id, b.escort_id
            FROM quotes q
            JOIN users u ON q.provider_id = u.id
            JOIN bookings b ON q.booking_id = b.id
            WHERE q.id = ?
        `, [quoteId]);

        if (quoteDetails.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Quote not found' });
        }

        const quote = quoteDetails[0];

        // 2. Authorization check - ONLY ADMINS can accept quotes
        if (req.user.role !== 'admin') {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Only administrators can accept and match quotes' });
        }

        // 3. Update the accepted quote
        await connection.query('UPDATE quotes SET status = "accepted" WHERE id = ?', [quoteId]);

        // 4. Update the booking with provider data
        if (quote.provider_role === 'escort') {
            await connection.query(`
                UPDATE bookings 
                SET escort_id = ?
                WHERE id = ?
            `, [quote.provider_id, quote.booking_id]);

            // Note: We might want to store escort_agreed_price if we had the field
        } else {
            await connection.query(`
                UPDATE bookings 
                SET carrier_id = ?, 
                    assigned_driver_id = ?, 
                    agreed_price = ?, 
                    status = 'booked' 
                WHERE id = ?
            `, [quote.provider_id, quote.driver_id, quote.amount, quote.booking_id]);

            // Reject other carrier quotes
            await connection.query(`
                UPDATE quotes q
                JOIN users u ON q.provider_id = u.id
                SET q.status = 'rejected'
                WHERE q.booking_id = ? AND q.id != ? AND u.role = 'carrier'
            `, [quote.booking_id, quoteId]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: `Quote accepted successfully. The ${quote.provider_role} has been assigned.`
        });
    } catch (error) {
        await connection.rollback();
        console.error('Accept quote error:', error);
        res.status(500).json({ success: false, message: 'Server error accepting quote' });
    } finally {
        connection.release();
    }
});

module.exports = router;
