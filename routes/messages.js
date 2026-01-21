const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('./notifications');

// @route   POST /api/messages/conversation
// @desc    Get or create a conversation for a booking and a participant
// @access  Private
router.post('/conversation', authMiddleware, async (req, res) => {
    try {
        let { bookingId, participantId } = req.body;
        const userId = req.user.id;

        if (!participantId) {
            return res.status(400).json({ success: false, message: 'Missing participantId' });
        }

        // Special case: resolve 'admin' to the first admin user
        if (participantId === 'admin') {
            const [admins] = await pool.query('SELECT id FROM users WHERE role = "admin" LIMIT 1');
            if (admins.length === 0) {
                return res.status(404).json({ success: false, message: 'No admin found to chat with' });
            }
            participantId = admins[0].id;

            // If the user *is* that admin, they can't chat with themselves
            if (userId === participantId) {
                return res.status(400).json({ success: false, message: 'Admin cannot chat with themselves as "admin"' });
            }
        }

        // 0. Verify booking exists if provided
        if (bookingId) {
            const [booking] = await pool.query('SELECT id FROM bookings WHERE id = ?', [bookingId]);
            if (booking.length === 0) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }
        }

        // 1. Check if conversation already exists between these two users (and optionally for this booking)
        let existingQuery = `
            SELECT c.id 
            FROM conversations c
            JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
            JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
            WHERE cp1.user_id = ? 
            AND cp2.user_id = ?
        `;
        let existingParams = [userId, participantId];

        if (bookingId) {
            existingQuery += " AND c.booking_id = ?";
            existingParams.push(bookingId);
        } else {
            existingQuery += " AND c.booking_id IS NULL";
        }

        const [existing] = await pool.query(existingQuery, existingParams);

        if (existing.length > 0) {
            return res.json({ success: true, data: { id: existing[0].id } });
        }

        // 2. Create new conversation
        const conversationId = uuidv4();
        await pool.query('INSERT INTO conversations (id, booking_id) VALUES (?, ?)', [conversationId, bookingId || null]);

        // 3. Add participants
        await pool.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)', [
            conversationId, userId,
            conversationId, participantId
        ]);

        res.json({ success: true, data: { id: conversationId } });
    } catch (error) {
        console.error('Create/get conversation error:', error);
        res.status(500).json({ success: false, message: 'Server error creating conversation' });
    }
});

// @route   GET /api/messages/conversations
// @desc    Get all conversations for the logged-in user
// @access  Private
router.get('/conversations', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const [conversations] = await pool.query(`
            SELECT 
                c.id, c.booking_id, c.updated_at,
                u.full_name as other_user_name,
                u.role as other_user_role,
                p.company_name as other_user_company,
                b.cargo_type,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND is_read = 0) as unread_count
            FROM conversations c
            JOIN conversation_participants cp_me ON c.id = cp_me.conversation_id AND cp_me.user_id = ?
            JOIN conversation_participants cp_other ON c.id = cp_other.conversation_id AND cp_other.user_id != ?
            JOIN users u ON cp_other.user_id = u.id
            LEFT JOIN profiles p ON u.id = p.user_id
            LEFT JOIN bookings b ON c.booking_id = b.id
            ORDER BY c.updated_at DESC
        `, [userId, userId, userId]);

        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Fetch conversations error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching conversations' });
    }
});

// @route   GET /api/messages/conversations/:conversationId
// @desc    Get messages for a conversation
// @access  Private
router.get('/conversations/:conversationId', authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // Verify user is a participant
        const [participant] = await pool.query(
            'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
            [conversationId, userId]
        );

        if (participant.length === 0) {
            return res.status(403).json({ success: false, message: 'Unauthorized access to conversation' });
        }

        const [messages] = await pool.query(
            'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [conversationId]
        );

        // Mark messages as read
        await pool.query(
            'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?',
            [conversationId, userId]
        );

        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Fetch messages error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching messages' });
    }
});

// @route   POST /api/messages
// @desc    Send a message
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { conversationId, content } = req.body;
        const userId = req.user.id;

        if (!conversationId || !content) {
            return res.status(400).json({ success: false, message: 'Missing conversationId or content' });
        }

        // Verify user is a participant
        const [participant] = await pool.query(
            'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
            [conversationId, userId]
        );

        if (participant.length === 0) {
            return res.status(403).json({ success: false, message: 'Unauthorized access to conversation' });
        }

        const messageId = uuidv4();
        await pool.query(
            'INSERT INTO messages (id, conversation_id, sender_id, content) VALUES (?, ?, ?, ?)',
            [messageId, conversationId, userId, content]
        );

        // Update conversation updated_at
        await pool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);

        // Get other participants to notify with their role
        const [recipients] = await pool.query(
            `SELECT cp.user_id, u.role 
             FROM conversation_participants cp 
             JOIN users u ON cp.user_id = u.id 
             WHERE cp.conversation_id = ? AND cp.user_id != ?`,
            [conversationId, userId]
        );

        const [sender] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);

        for (const recipient of recipients) {
            const dashboardLink = `/dashboard/${recipient.role}?section=messages&conversationId=${conversationId}`;

            await createNotification({
                userId: recipient.user_id,
                type: 'message',
                title: 'New Message',
                message: `New message from ${sender[0].full_name}`,
                link: dashboardLink,
                metadata: { conversationId, messageId }
            });
        }

        res.json({ success: true, data: { id: messageId, conversationId, sender_id: userId, content, created_at: new Date() } });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: 'Server error sending message' });
    }
});

module.exports = router;
