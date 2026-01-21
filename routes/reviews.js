const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('./notifications');

// @route   POST /api/reviews
// @desc    Left a review for a booking
// @access  Private (Shipper)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { bookingId, subjectId, rating, comment } = req.body;
        const reviewerId = req.user.id;

        if (!bookingId || !subjectId || !rating) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Check if booking exists and is completed
        const [booking] = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Only shipper of the booking can leave review
        if (booking[0].shipper_id !== reviewerId) {
            return res.status(403).json({ success: false, message: 'Not authorized to review this booking' });
        }

        if (booking[0].status !== 'completed' && booking[0].status !== 'delivered') {
            return res.status(400).json({ success: false, message: 'Booking must be completed before reviewing' });
        }

        // Check if already reviewed
        const [existing] = await pool.query(
            'SELECT id FROM reviews WHERE booking_id = ? AND reviewer_id = ?',
            [bookingId, reviewerId]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'You have already reviewed this booking' });
        }

        const id = uuidv4();
        await pool.query(
            'INSERT INTO reviews (id, booking_id, reviewer_id, subject_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)',
            [id, bookingId, reviewerId, subjectId, rating, comment]
        );

        // Notify provider
        const [provider] = await pool.query('SELECT role FROM users WHERE id = ?', [subjectId]);
        const providerRole = provider[0]?.role || 'carrier'; // fallback
        const dashboardLink = `/dashboard/${providerRole}?section=reviews`;

        await createNotification({
            userId: subjectId,
            type: 'review',
            title: 'New Review Received',
            message: `You received a ${rating}-star review for ${booking[0].cargo_type}`,
            link: dashboardLink,
            metadata: { reviewId: id, bookingId }
        });

        res.json({ success: true, message: 'Review submitted successfully' });
    } catch (error) {
        console.error('Submit review error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/reviews/provider/:providerId
// @desc    Get reviews for a carrier/escort
// @access  Public
router.get('/provider/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;

        const [reviews] = await pool.query(`
            SELECT r.*, u.full_name as reviewer_name, p.company_name as reviewer_company
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            LEFT JOIN profiles p ON u.id = p.user_id
            WHERE r.subject_id = ?
            ORDER BY r.created_at DESC
        `, [providerId]);

        res.json({ success: true, data: reviews });
    } catch (error) {
        console.error('Fetch provider reviews error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/reviews/my-reviews
// @desc    Get reviews left by current user
// @access  Private
router.get('/my-reviews', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const [reviews] = await pool.query(`
            SELECT r.*, u.full_name as subject_name, p.company_name as subject_company, b.cargo_type
            FROM reviews r
            JOIN users u ON r.subject_id = u.id
            LEFT JOIN profiles p ON u.id = p.user_id
            JOIN bookings b ON r.booking_id = b.id
            WHERE r.reviewer_id = ?
            ORDER BY r.created_at DESC
        `, [userId]);

        res.json({ success: true, data: reviews });
    } catch (error) {
        console.error('Fetch my reviews error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/reviews/stats/:providerId
// @desc    Get average rating stats for a provider
// @access  Public
router.get('/stats/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;

        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total_reviews,
                AVG(rating) as average_rating
            FROM reviews 
            WHERE subject_id = ?
        `, [providerId]);

        res.json({ success: true, data: stats[0] });
    } catch (error) {
        console.error('Fetch review stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
