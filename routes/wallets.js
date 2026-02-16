const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// @route   GET /api/wallets/me
// @desc    Get my wallet balance and transactions
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const [wallet] = await pool.query(
            'SELECT balance, pending_balance, currency FROM wallets WHERE user_id = ?',
            [userId]
        );

        if (wallet.length === 0) {
            return res.status(404).json({ success: false, message: 'Wallet not found' });
        }

        const [transactions] = await pool.query(`
            SELECT wt.*, 
                   b.cargo_type, b.pickup_city, b.delivery_city,
                   ba.bank_name, ba.account_number
            FROM wallet_transactions wt
            LEFT JOIN bookings b ON wt.reference_id = b.id AND wt.type IN ('booking_pending', 'booking_completed')
            LEFT JOIN withdrawals w ON wt.reference_id = w.id AND wt.type = 'withdrawal_requested'
            LEFT JOIN bank_accounts ba ON w.bank_account_id = ba.id
            WHERE wt.wallet_id = ? 
            ORDER BY wt.created_at DESC 
            LIMIT 50
        `, [userId]);

        res.json({
            success: true,
            data: {
                ...wallet[0],
                transactions
            }
        });
    } catch (error) {
        console.error('Fetch wallet error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/wallets/bank-accounts
// @desc    Get my bank accounts
// @access  Private
router.get('/bank-accounts', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const [accounts] = await pool.query(
            'SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC',
            [userId]
        );
        res.json({ success: true, data: accounts });
    } catch (error) {
        console.error('Fetch bank accounts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/wallets/bank-accounts
// @desc    Add a bank account
// @access  Private
router.post('/bank-accounts', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { account_holder_name, bank_name, account_number, routing_number, swift_code, account_type } = req.body;

        if (!account_holder_name || !bank_name || !account_number) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const id = uuidv4();

        // If it's the first account, make it primary
        const [existing] = await pool.query('SELECT id FROM bank_accounts WHERE user_id = ?', [userId]);
        const is_primary = existing.length === 0 ? 1 : 0;

        await pool.query(`
            INSERT INTO bank_accounts (id, user_id, account_holder_name, bank_name, account_number, routing_number, swift_code, account_type, is_primary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, userId, account_holder_name, bank_name, account_number, routing_number || null, swift_code || null, account_type || 'checking', is_primary]);

        res.status(201).json({ success: true, message: 'Bank account added successfully' });
    } catch (error) {
        console.error('Add bank account error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/wallets/withdraw
// @desc    Request a withdrawal
// @access  Private
router.post('/withdraw', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.id;
        const { amount, bank_account_id } = req.body;

        if (!amount || amount <= 0 || !bank_account_id) {
            return res.status(400).json({ success: false, message: 'Invalid withdrawal request' });
        }

        await connection.beginTransaction();

        // Check balance
        const [wallet] = await connection.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
        if (wallet.length === 0 || parseFloat(wallet[0].balance) < parseFloat(amount)) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        // Deduct from balance immediately? 
        // Typically we move it to "pending withdrawal" or just deduct it to prevent double withdrawal.
        // Let's deduct and mark transaction as pending.
        await connection.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [amount, userId]);

        const withdrawalId = uuidv4();
        await connection.query(`
            INSERT INTO withdrawals (id, user_id, bank_account_id, amount, status)
            VALUES (?, ?, ?, ?, 'pending')
        `, [withdrawalId, userId, bank_account_id, amount]);

        await connection.query(`
            INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
            VALUES (?, ?, 'withdrawal_requested', 'pending', ?, ?)
        `, [userId, -amount, withdrawalId, `Withdrawal request for $${amount}`]);

        await connection.commit();
        res.json({ success: true, message: 'Withdrawal request submitted successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        connection.release();
    }
});

// --- ADMIN ROUTES ---

// @route   GET /api/wallets/admin/all
// @desc    Get all wallet balances (Admin Only)
// @access  Private/Admin
router.get('/admin/all', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const [wallets] = await pool.query(`
            SELECT w.*, u.full_name, u.role, u.email
            FROM wallets w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.balance DESC
        `);

        // Calculate total system holdings
        const totalBalance = wallets.reduce((sum, w) => sum + parseFloat(w.balance), 0);
        const totalPending = wallets.reduce((sum, w) => sum + parseFloat(w.pending_balance), 0);

        res.json({
            success: true,
            data: {
                wallets,
                totals: {
                    balance: totalBalance,
                    pending: totalPending
                }
            }
        });
    } catch (error) {
        console.error('Fetch all wallets error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/wallets/admin/withdrawals
// @desc    Get all withdrawal requests (Admin Only)
// @access  Private/Admin
router.get('/admin/withdrawals', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const [withdrawals] = await pool.query(`
            SELECT w.*, u.full_name, u.email, ba.bank_name, ba.account_number, ba.account_holder_name
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
            JOIN bank_accounts ba ON w.bank_account_id = ba.id
            ORDER BY w.requested_at DESC
        `);

        res.json({ success: true, data: withdrawals });
    } catch (error) {
        console.error('Fetch withdrawals error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/wallets/admin/withdrawals/:id/approve
// @desc    Approve a withdrawal (Admin Only)
// @access  Private/Admin
router.post('/admin/withdrawals/:id/approve', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const adminId = req.user.id;

        await connection.beginTransaction();

        const [withdrawal] = await connection.query('SELECT * FROM withdrawals WHERE id = ?', [id]);
        if (withdrawal.length === 0 || withdrawal[0].status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Invalid or already processed withdrawal' });
        }

        const w = withdrawal[0];

        await connection.query(`
            UPDATE withdrawals 
            SET status = 'completed', processed_at = NOW(), processed_by = ?
            WHERE id = ?
        `, [adminId, id]);

        // Update the transaction status in history
        await connection.query(`
            UPDATE wallet_transactions 
            SET status = 'completed'
            WHERE wallet_id = ? AND reference_id = ? AND type = 'withdrawal_requested'
        `, [w.user_id, id]);

        await connection.commit();
        res.json({ success: true, message: 'Withdrawal approved and marked as completed' });
    } catch (error) {
        await connection.rollback();
        console.error('Approve withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        connection.release();
    }
});

// @route   POST /api/wallets/admin/withdrawals/:id/reject
// @desc    Reject a withdrawal (Admin Only)
// @access  Private/Admin
router.post('/admin/withdrawals/:id/reject', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const { reason } = req.body;
        const adminId = req.user.id;

        await connection.beginTransaction();

        const [withdrawal] = await connection.query('SELECT * FROM withdrawals WHERE id = ?', [id]);
        if (withdrawal.length === 0 || withdrawal[0].status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Invalid or already processed withdrawal' });
        }

        const w = withdrawal[0];

        // Refund the balance
        await connection.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [w.amount, w.user_id]);

        await connection.query(`
            UPDATE withdrawals 
            SET status = 'rejected', rejection_reason = ?, processed_at = NOW(), processed_by = ?
            WHERE id = ?
        `, [reason || 'Rejected by admin', adminId, id]);

        // Mark transaction as failed/rejected and record refund
        await connection.query(`
            UPDATE wallet_transactions 
            SET status = 'rejected'
            WHERE wallet_id = ? AND reference_id = ? AND type = 'withdrawal_requested'
        `, [w.user_id, id]);

        await connection.query(`
            INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
            VALUES (?, ?, 'refund', 'completed', ?, ?)
        `, [w.user_id, w.amount, id, `Refund for rejected withdrawal request`]);

        await connection.commit();
        res.json({ success: true, message: 'Withdrawal request rejected and funds returned' });
    } catch (error) {
        await connection.rollback();
        console.error('Reject withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        connection.release();
    }
});

module.exports = router;
