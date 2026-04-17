const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('./notifications');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypalService = require('../services/paypalService');
const { finalizePayment, calculatePlatformFee } = require('../services/paymentService');
const settingsService = require('../services/settingsService');

// @route   GET /api/payments/awaiting
// @desc    Get bookings awaiting payment for shipper
// @access  Private (Shipper only)
router.get('/awaiting', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        if (userRole !== 'shipper') {
            return res.status(403).json({ success: false, message: 'Only shippers can access this endpoint' });
        }

        const [bookings] = await pool.query(`
            SELECT b.*, 
                   cu.full_name as carrier_name, 
                   cp.company_name as carrier_company,
                   eu.full_name as escort_name, 
                   ep.company_name as escort_company
            FROM bookings b
            LEFT JOIN users cu ON b.carrier_id = cu.id
            LEFT JOIN profiles cp ON b.carrier_id = cp.user_id
            LEFT JOIN users eu ON b.escort_id = eu.id
            LEFT JOIN profiles ep ON b.escort_id = ep.user_id
            WHERE b.shipper_id = ? AND b.status = 'awaiting_payment'
            ORDER BY b.created_at DESC
        `, [userId]);

        const platformFeePercentage = await settingsService.getPlatformFeePercentage();

        res.json({ 
            success: true, 
            data: bookings,
            platformFeePercentage
        });
    } catch (error) {
        console.error('Fetch awaiting payments error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching payments' });
    }
});

// @route   GET /api/payments/history
// @desc    Get payment history for shipper
// @access  Private (Shipper only)
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const [payments] = await pool.query(`
            SELECT p.*, 
                   b.cargo_type, 
                   b.pickup_city, 
                   b.pickup_state,
                   b.delivery_city,
                   b.delivery_state,
                   b.id as booking_id
            FROM payments p
            LEFT JOIN bookings b ON p.booking_id = b.id
            WHERE p.payer_id = ?
            ORDER BY p.created_at DESC
        `, [userId]);

        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('Fetch payment history error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching payment history' });
    }
});

// @route   POST /api/payments/create-checkout-session
// @desc    Create a Stripe Checkout session
// @access  Private (Shipper only)
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.body;

        const [booking] = await pool.query(
            'SELECT * FROM bookings WHERE id = ? AND shipper_id = ?',
            [bookingId, userId]
        );

        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const b = booking[0];

        if (!b.agreed_price || isNaN(parseFloat(b.agreed_price))) {
            return res.status(400).json({ success: false, message: 'Booking does not have a valid agreed price' });
        }

        const amount = parseFloat(b.agreed_price);
        const platformFee = await calculatePlatformFee(amount, b);
        const totalAmount = amount + platformFee;
        const unitAmount = Math.round(totalAmount * 100);

        if (unitAmount < 50) {
            return res.status(400).json({ success: false, message: 'Total amount is too small for Stripe (minimum $0.50)' });
        }

        console.log(`DEBUG: Creating Stripe session for Booking ${bookingId}, Amount: ${unitAmount} cents`);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Booking #${bookingId.substring(0, 8)}`,
                        description: `${b.cargo_type} transport`,
                    },
                    unit_amount: unitAmount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/dashboard/shipper?section=payments&payment_success=true&provider=stripe`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/dashboard/shipper?section=payments&payment_canceled=true`,
            metadata: {
                bookingId: bookingId,
                userId: userId.toString()
            }
        });

        res.json({ success: true, url: session.url });
    } catch (error) {
        console.error('Stripe session error:', error.message);
        if (error.stack) console.error(error.stack);

        res.status(500).json({
            success: false,
            message: 'Error creating Stripe session',
            error: error.message
        });
    }
});

// @route   POST /api/payments/create-paypal-order
router.post('/create-paypal-order', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { bookingId } = req.body;

        const [booking] = await pool.query(
            'SELECT * FROM bookings WHERE id = ? AND shipper_id = ?',
            [bookingId, userId]
        );

        if (booking.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const b = booking[0];
        const amount = parseFloat(b.agreed_price);
        const platformFee = await calculatePlatformFee(amount, b);
        const totalAmount = amount + platformFee;

        const order = await paypalService.createOrder(bookingId, userId, totalAmount);
        const approveLink = order.links.find(link => link.rel === 'approve');

        res.json({ success: true, url: approveLink.href });
    } catch (error) {
        console.error('PayPal order error:', error);
        res.status(500).json({ success: false, message: 'Error creating PayPal order' });
    }
});

// @route   POST /api/payments/capture-paypal
router.post('/capture-paypal', authMiddleware, async (req, res) => {
    try {
        const { token, bookingId } = req.body;
        const userId = req.user.id;

        if (!token) return res.status(400).json({ success: false, message: 'Token is required' });
        if (!bookingId) return res.status(400).json({ success: false, message: 'Booking ID is required' });

        const order = await paypalService.getOrder(token);

        let orderBookingId, orderUserId;
        try {
            const customIdStr = order.purchase_units[0].custom_id;
            const parsed = JSON.parse(customIdStr);
            orderBookingId = parsed.bookingId;
            orderUserId = parsed.userId;
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid custom_id in order' });
        }

        if (orderBookingId !== bookingId || orderUserId !== userId) {
            return res.status(400).json({ success: false, message: 'Invalid booking or user for this payment' });
        }

        if (order.status === 'COMPLETED') {
            await finalizePayment(bookingId, userId, token, 'paypal');
            return res.json({ success: true, message: 'Payment verified successfully' });
        } else if (order.status === 'APPROVED') {
            const capture = await paypalService.captureOrder(token);
            if (capture.status === 'COMPLETED') {
                await finalizePayment(bookingId, userId, token, 'paypal');
                return res.json({ success: true, message: 'Payment captured successfully' });
            } else {
                return res.status(400).json({ success: false, message: 'Payment could not be captured' });
            }
        } else {
            return res.status(400).json({ success: false, message: 'Order is not approved' });
        }
    } catch (error) {
        console.error('Capture PayPal error:', error);
        res.status(500).json({ success: false, message: 'Error capturing PayPal payment' });
    }
});

// @route   POST /api/payments/process
// @desc    Process payment for a booking
// @access  Private (Shipper only)
router.post('/process', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { bookingId, paymentMethod, paymentDetails } = req.body;

        if (userRole !== 'shipper') {
            return res.status(403).json({ success: false, message: 'Only shippers can make payments' });
        }

        if (!bookingId || !paymentMethod) {
            return res.status(400).json({ success: false, message: 'Booking ID and payment method are required' });
        }

        await connection.beginTransaction();

        // 1. Get booking details
        const [booking] = await connection.query(
            'SELECT * FROM bookings WHERE id = ? AND shipper_id = ?',
            [bookingId, userId]
        );

        if (booking.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found or unauthorized' });
        }

        const b = booking[0];

        if (b.status !== 'awaiting_payment') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Booking is not awaiting payment' });
        }

        if (!b.agreed_price || b.agreed_price <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Invalid booking price' });
        }

        // 2. Fetch accepted quotes to get breakdown
        const [acceptedQuotes] = await connection.query(`
            SELECT q.*, u.role 
            FROM quotes q 
            JOIN users u ON q.provider_id = u.id 
            WHERE q.booking_id = ? AND q.status = 'accepted'
        `, [bookingId]);

        let carrierAmount = 0;
        let escortAmount = 0;
        let carrierId = b.carrier_id;
        let escortId = b.escort_id;

        acceptedQuotes.forEach(q => {
            if (q.role === 'carrier') carrierAmount = parseFloat(q.amount);
            if (q.role === 'escort') escortAmount = parseFloat(q.amount);
        });

        // 3. Calculate payment amounts
        const bookingAmount = parseFloat(b.agreed_price);
        const platformFeePercentage = await settingsService.getPlatformFeePercentage();
        const platformFee = bookingAmount * platformFeePercentage;
        const totalAmount = bookingAmount + platformFee;

        // 4. Process payment based on method
        let paymentStatus = 'pending';
        let transactionRef = null;

        if (paymentMethod === 'stripe') {
            paymentStatus = 'completed';
            transactionRef = 'STRIPE_PLACEHOLDER_' + uuidv4().substring(0, 8);
        } else if (paymentMethod === 'paypal') {
            paymentStatus = 'completed';
            transactionRef = 'PAYPAL_PLACEHOLDER_' + uuidv4().substring(0, 8);
        } else {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        }

        // 5. Create payment record
        const paymentId = uuidv4();
        await connection.query(`
            INSERT INTO payments (
                id, booking_id, payer_id, amount, carrier_amount, escort_amount, 
                platform_fee, total_amount, method, transaction_ref, status, metadata
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            paymentId,
            bookingId,
            userId,
            bookingAmount,
            carrierAmount,
            escortAmount,
            platformFee,
            totalAmount,
            paymentMethod,
            transactionRef,
            paymentStatus,
            JSON.stringify(paymentDetails || {})
        ]);

        // 6. Update booking status and wallets if payment successful
        if (paymentStatus === 'completed') {
            await connection.query(
                'UPDATE bookings SET status = "booked" WHERE id = ?',
                [bookingId]
            );

            // Update Carrier Wallet (Pending)
            if (carrierId && carrierAmount > 0) {
                await connection.query(
                    'UPDATE wallets SET pending_balance = pending_balance + ? WHERE user_id = ?',
                    [carrierAmount, carrierId]
                );
                await connection.query(`
                    INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                    VALUES (?, ?, 'booking_pending', 'completed', ?, ?)
                `, [carrierId, carrierAmount, bookingId, `Pending payment for booking ${bookingId}`]);
            }

            // Update Escort Wallet (Pending)
            if (escortId && escortAmount > 0) {
                await connection.query(
                    'UPDATE wallets SET pending_balance = pending_balance + ? WHERE user_id = ?',
                    [escortAmount, escortId]
                );
                await connection.query(`
                    INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                    VALUES (?, ?, 'booking_pending', 'completed', ?, ?)
                `, [escortId, escortAmount, bookingId, `Pending payment for escort service on booking ${bookingId}`]);
            }

            const [adminUser] = await connection.query('SELECT id FROM users WHERE role = "admin" LIMIT 1');
            if (adminUser.length > 0) {
                const adminId = adminUser[0].id;
                await connection.query(
                    'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                    [platformFee, adminId]
                );
                await connection.query(`
                    INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                    VALUES (?, ?, 'fee', 'completed', ?, ?)
                `, [adminId, platformFee, bookingId, `Platform fee for booking ${bookingId}`]);
            }

            // 6. Notify carrier
            if (b.carrier_id) {
                await createNotification({
                    userId: b.carrier_id,
                    type: 'payment_received',
                    title: 'Payment Received - Job Confirmed',
                    message: `Payment confirmed for ${b.cargo_type} shipment. You can now start the job.`,
                    link: '/dashboard/carrier?section=bookings',
                    metadata: { bookingId, paymentId }
                });
            }

            // 7. Notify escort if applicable
            if (b.escort_id) {
                await createNotification({
                    userId: b.escort_id,
                    type: 'payment_received',
                    title: 'Payment Received - Job Confirmed',
                    message: `Payment confirmed for ${b.cargo_type} escort service. Job is now active.`,
                    link: '/dashboard/escort?section=available',
                    metadata: { bookingId, paymentId }
                });
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Payment processed successfully',
            data: {
                paymentId,
                transactionRef,
                amount: bookingAmount,
                platformFee,
                totalAmount,
                status: paymentStatus
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Process payment error:', error);
        res.status(500).json({ success: false, message: 'Server error processing payment' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/payments/:id
// @desc    Get payment details
// @access  Private
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [payment] = await pool.query(`
            SELECT p.*, 
                   b.cargo_type, 
                   b.pickup_city, 
                   b.pickup_state,
                   b.delivery_city,
                   b.delivery_state
            FROM payments p
            LEFT JOIN bookings b ON p.booking_id = b.id
            WHERE p.id = ? AND p.payer_id = ?
        `, [id, userId]);

        if (payment.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        res.json({ success: true, data: payment[0] });
    } catch (error) {
        console.error('Fetch payment error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching payment' });
    }
});

module.exports = router;
