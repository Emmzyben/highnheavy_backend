const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { sendNotificationEmail } = require('../services/email');

// @route   GET /api/notifications
// @desc    Get all notifications for logged-in user
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 50, offset = 0 } = req.query;

        const [notifications] = await pool.query(
            `SELECT * FROM notifications 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [userId, parseInt(limit), parseInt(offset)]
        );

        const [unreadCount] = await pool.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        res.json({
            success: true,
            data: {
                notifications,
                unreadCount: unreadCount[0].count
            }
        });
    } catch (error) {
        console.error('Fetch notifications error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching notifications' });
    }
});

// @route   GET /api/notifications/unread-count
// @desc    Get unread notification count
// @access  Private
router.get('/unread-count', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const [result] = await pool.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        res.json({
            success: true,
            data: { count: result[0].count }
        });
    } catch (error) {
        console.error('Fetch unread count error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching unread count' });
    }
});

// @route   PATCH /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.patch('/:id/read', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        await pool.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: 'Server error marking notification as read' });
    }
});

// @route   PATCH /api/notifications/mark-all-read
// @desc    Mark all notifications as read
// @access  Private
router.patch('/mark-all-read', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        await pool.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({ success: false, message: 'Server error marking all as read' });
    }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        await pool.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting notification' });
    }
});

// Helper function to create notification (can be imported by other routes)
const createNotification = async ({ userId, type, title, message, link, metadata }) => {
    try {
        const id = uuidv4();
        await pool.query(
            `INSERT INTO notifications (id, user_id, type, title, message, link, metadata) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, type, title, message, link, JSON.stringify(metadata || {})]
        );

        // Check if user has email notifications enabled
        const [users] = await pool.query(
            'SELECT email, email_notifications FROM users WHERE id = ?',
            [userId]
        );

        if (users.length > 0 && users[0].email_notifications) {
            // Send email in background (don't await to avoid slowing down the response)
            sendNotificationEmail(users[0].email, title, message).catch(err => {
                console.error('Error sending notification email:', err);
            });
        }

        return { success: true, id };
    } catch (error) {
        console.error('Create notification error:', error);
        return { success: false, error };
    }
};

module.exports = router;
module.exports.createNotification = createNotification;
