const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// @route   GET /api/quotes/available
// @desc    Get bookings that are available for quoting
// @access  Private (Carrier only)
router.get('/available', authMiddleware, async (req, res) => {
    try {
        const carrierId = req.user.id;

        // Find bookings with status 'pending_quote' or 'quoted' that the carrier hasn't quoted on yet
        // and that don't have a carrier assigned yet
        const [availableBookings] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name 
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            WHERE b.carrier_id IS NULL 
            AND b.status IN ('pending_quote', 'quoted')
            AND b.id NOT IN (SELECT booking_id FROM quotes WHERE provider_id = ?)
            ORDER BY b.created_at DESC
        `, [carrierId]);

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
        const carrierId = req.user.id;

        const [myQuotes] = await pool.query(`
            SELECT q.*, b.*, q.id as quote_id, q.status as quote_status, u.full_name as shipper_name
            FROM quotes q
            JOIN bookings b ON q.booking_id = b.id
            JOIN users u ON b.shipper_id = u.id
            WHERE q.provider_id = ?
            ORDER BY q.created_at DESC
        `, [carrierId]);

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
        const carrierId = req.user.id;

        const [wonJobs] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            WHERE b.carrier_id = ?
            ORDER BY b.updated_at DESC
        `, [carrierId]);

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
// @access  Private (Carrier only)
router.post('/', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const carrierId = req.user.id;
        const { booking_id, amount, driver_id, vehicle_id, notes } = req.body;

        if (!booking_id || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        await connection.beginTransaction();

        // 1. Check if booking exists and is available
        const [booking] = await connection.query('SELECT status, carrier_id FROM bookings WHERE id = ?', [booking_id]);
        if (booking.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking[0].carrier_id) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Carrier already assigned to this booking' });
        }

        // 2. Check if carrier already quoted
        const [existingQuote] = await connection.query('SELECT id FROM quotes WHERE booking_id = ? AND provider_id = ?', [booking_id, carrierId]);
        if (existingQuote.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'You have already submitted a quote for this booking' });
        }

        // 3. Create quote
        const quoteId = uuidv4();
        await connection.query(`
            INSERT INTO quotes (id, booking_id, provider_id, amount, driver_id, vehicle_id, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [quoteId, booking_id, carrierId, amount, driver_id || null, vehicle_id || null, notes]);

        // 4. Update booking status to 'quoted' if it was 'pending_quote'
        if (booking[0].status === 'pending_quote') {
            await connection.query('UPDATE bookings SET status = "quoted" WHERE id = ?', [booking_id]);
        }

        await connection.commit();

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

// @route   GET /api/quotes/all-admin
// @desc    Get all quotes (Admin Only)
// @access  Private (Admin)
router.get('/all-admin', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const [quotes] = await pool.query(`
            SELECT 
                q.*, 
                u.full_name as carrier_name, 
                b.cargo_type, 
                b.pickup_city, 
                b.pickup_state, 
                b.delivery_city, 
                b.delivery_state,
                b.shipment_date,
                s.full_name as shipper_name
            FROM quotes q
            JOIN users u ON q.provider_id = u.id
            JOIN bookings b ON q.booking_id = b.id
            JOIN users s ON b.shipper_id = s.id
            ORDER BY q.created_at DESC
        `);

        res.json({
            success: true,
            data: quotes
        });
    } catch (error) {
        console.error('Fetch all quotes admin error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching quotes' });
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
            SELECT q.*, u.full_name as carrier_name, d.name as driver_name, v.name as vehicle_name
            FROM quotes q
            JOIN users u ON q.provider_id = u.id
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
// @desc    Accept a quote and link carrier/driver to booking
// @access  Private (Shipper of the booking)
router.put('/:id/accept', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const quoteId = req.params.id;
        const userId = req.user.id; // Shipper ID

        await connection.beginTransaction();

        // 1. Get quote details and verify booking ownership
        const [quoteDetails] = await connection.query(`
            SELECT q.*, b.shipper_id, b.id as booking_id 
            FROM quotes q
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

        // 3. Check if booking is still open
        const [bookingStatus] = await connection.query('SELECT status FROM bookings WHERE id = ?', [quote.booking_id]);
        if (bookingStatus[0].status === 'booked' || bookingStatus[0].status === 'completed') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'This booking has already been awarded to a carrier' });
        }

        // 4. Update the accepted quote
        await connection.query('UPDATE quotes SET status = "accepted" WHERE id = ?', [quoteId]);

        // 5. Reject all other quotes for this booking
        await connection.query('UPDATE quotes SET status = "rejected" WHERE booking_id = ? AND id != ?', [quote.booking_id, quoteId]);

        // 6. UPDATE BOOKING WITH QUOTE DATA (Carrier, Driver, Amount)
        await connection.query(`
            UPDATE bookings 
            SET carrier_id = ?, 
                assigned_driver_id = ?, 
                agreed_price = ?, 
                status = 'booked' 
            WHERE id = ?
        `, [quote.provider_id, quote.driver_id, quote.amount, quote.booking_id]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Quote accepted successfully. The carrier has been assigned to this booking.'
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
