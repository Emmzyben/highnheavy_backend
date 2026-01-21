const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');

// @route   GET /api/admin/stats
// @desc    Get dashboard summary stats
// @access  Private (Admin only)
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const [userStats] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN role = 'shipper' THEN 1 END) as shippers,
                COUNT(CASE WHEN role = 'carrier' THEN 1 END) as carriers,
                COUNT(CASE WHEN role = 'escort' THEN 1 END) as escorts
            FROM users
        `);

        const [bookingStats] = await pool.query(`
            SELECT COUNT(*) as total FROM bookings
        `);

        const [pendingVerifications] = await pool.query(`
            SELECT COUNT(*) as total FROM users WHERE profile_completed = 0 AND role IN ('carrier', 'escort')
        `);

        // Get 3 latest unmatched bookings
        const [latestUnmatched] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name, p.company_name as shipper_company
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            WHERE b.status IN ('pending_quote', 'quoted')
            ORDER BY b.created_at DESC
            LIMIT 3
        `);

        res.json({
            success: true,
            data: {
                shippers: userStats[0].shippers,
                carriers: userStats[0].carriers,
                escorts: userStats[0].escorts,
                bookings: bookingStats[0].total,
                pendingVerifications: pendingVerifications[0].total,
                latestUnmatched
            }
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/admin/unmatched-bookings
// @desc    Get bookings that need to be matched with providers
// @access  Private (Admin only)
router.get('/unmatched-bookings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const [bookings] = await pool.query(`
            SELECT 
                b.*, 
                u.full_name as shipper_name,
                p.company_name as shipper_company,
                (SELECT COUNT(*) FROM quotes q JOIN users u_q ON q.provider_id = u_q.id WHERE q.booking_id = b.id AND u_q.role = 'carrier') as carrier_quote_count,
                (SELECT COUNT(*) FROM quotes q JOIN users u_q ON q.provider_id = u_q.id WHERE q.booking_id = b.id AND u_q.role = 'escort') as escort_quote_count
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            WHERE b.status IN ('pending_quote', 'quoted')
            ORDER BY b.created_at DESC
        `);

        res.json({ success: true, data: bookings });
    } catch (error) {
        console.error('Fetch unmatched bookings error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/admin/assign-providers
// @desc    Assign carrier and escort to a booking (Admin Only)
// @access  Private (Admin)
router.post('/assign-providers', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { booking_id, carrier_quote_id, escort_quote_id } = req.body;

        if (!booking_id || !carrier_quote_id) {
            return res.status(400).json({ success: false, message: 'Missing booking ID or carrier quote ID' });
        }

        await connection.beginTransaction();

        // 1. Get carrier quote details
        const [cQuote] = await connection.query('SELECT * FROM quotes WHERE id = ?', [carrier_quote_id]);
        if (cQuote.length === 0) throw new Error('Carrier quote not found');
        const carrierQuote = cQuote[0];

        // 2. Start building update query for booking
        let updateQuery = 'UPDATE bookings SET carrier_id = ?, assigned_driver_id = ?, agreed_price = ?, status = "booked"';
        let updateParams = [carrierQuote.provider_id, carrierQuote.driver_id, carrierQuote.amount];

        // 3. Handle escort if provided
        if (escort_quote_id) {
            const [eQuote] = await connection.query('SELECT * FROM quotes WHERE id = ?', [escort_quote_id]);
            if (eQuote.length > 0) {
                updateQuery += ', escort_id = ?';
                updateParams.push(eQuote[0].provider_id);

                // Mark escort quote as accepted
                await connection.query('UPDATE quotes SET status = "accepted" WHERE id = ?', [escort_quote_id]);
            }
        }

        updateQuery += ' WHERE id = ?';
        updateParams.push(booking_id);

        // 4. Update booking
        await connection.query(updateQuery, updateParams);

        // 5. Mark carrier quote as accepted
        await connection.query('UPDATE quotes SET status = "accepted" WHERE id = ?', [carrier_quote_id]);

        // 6. Reject other quotes for this booking
        await connection.query('UPDATE quotes SET status = "rejected" WHERE booking_id = ? AND status = "pending"', [booking_id]);

        // 7. Get booking and shipper details for notifications
        const [bookingDetails] = await connection.query(`
            SELECT b.*, u.full_name as shipper_name, u.id as shipper_id
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            WHERE b.id = ?
        `, [booking_id]);
        const booking = bookingDetails[0];

        // 8. Notify carrier
        await createNotification({
            userId: carrierQuote.provider_id,
            type: 'quote_accepted',
            title: 'Quote Accepted!',
            message: `Your quote for ${booking.cargo_type} shipment has been accepted`,
            link: '/dashboard/carrier?section=bookings',
            metadata: { bookingId: booking_id, quoteId: carrier_quote_id }
        });

        // 9. Notify escort if applicable
        if (escort_quote_id) {
            const [eQuote] = await connection.query('SELECT provider_id FROM quotes WHERE id = ?', [escort_quote_id]);
            if (eQuote.length > 0) {
                await createNotification({
                    userId: eQuote[0].provider_id,
                    type: 'quote_accepted',
                    title: 'Escort Assignment Confirmed!',
                    message: `You've been assigned to escort ${booking.cargo_type} shipment`,
                    link: '/dashboard/escort?section=available',
                    metadata: { bookingId: booking_id, quoteId: escort_quote_id }
                });
            }
        }

        // 10. Notify shipper
        await createNotification({
            userId: booking.shipper_id,
            type: 'booking_update',
            title: 'Booking Confirmed',
            message: `Your ${booking.cargo_type} booking has been confirmed with carrier and assigned`,
            link: '/dashboard/shipper?section=bookings',
            metadata: { bookingId: booking_id }
        });

        await connection.commit();
        res.json({ success: true, message: 'Providers assigned and booking confirmed' });

    } catch (error) {
        await connection.rollback();
        console.error('Assign providers error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error assigning providers' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/admin/users/:userId/bookings
// @desc    Get bookings for a specific user (shipper, carrier, or escort)
// @access  Private (Admin only)
router.get('/users/:userId/bookings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { userId } = req.params;

        const [bookings] = await pool.query(`
            SELECT b.*, 
                   u_s.full_name as shipper_name,
                   u_c.full_name as carrier_name,
                   u_e.full_name as escort_name,
                   p_s.company_name as shipper_company
            FROM bookings b
            LEFT JOIN users u_s ON b.shipper_id = u_s.id
            LEFT JOIN profiles p_s ON b.shipper_id = p_s.user_id
            LEFT JOIN users u_c ON b.carrier_id = u_c.id
            LEFT JOIN users u_e ON b.escort_id = u_e.id
            WHERE b.shipper_id = ? OR b.carrier_id = ? OR b.escort_id = ?
            ORDER BY b.created_at DESC
        `, [userId, userId, userId]);

        res.json({ success: true, data: bookings });
    } catch (error) {
        console.error('Fetch user bookings error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching user bookings' });
    }
});

// @route   GET /api/admin/users/:userId/drivers
// @desc    Get drivers for a specific carrier
// @access  Private (Admin only)
router.get('/users/:userId/drivers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { userId } = req.params;
        const [drivers] = await pool.query(
            'SELECT * FROM drivers WHERE employer_id = ? ORDER BY name ASC',
            [userId]
        );

        res.json({ success: true, data: drivers });
    } catch (error) {
        console.error('Fetch user drivers error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/admin/users/:userId/vehicles
// @desc    Get vehicles for a specific carrier or escort
// @access  Private (Admin only)
router.get('/users/:userId/vehicles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { userId } = req.params;
        const [vehicles] = await pool.query(
            'SELECT * FROM vehicles WHERE owner_id = ? ORDER BY created_at DESC',
            [userId]
        );

        res.json({ success: true, data: vehicles });
    } catch (error) {
        console.error('Fetch user vehicles error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
