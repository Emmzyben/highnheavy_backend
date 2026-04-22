const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('../routes/notifications');
const settingsService = require('./settingsService');

/**
 * Finalize a payment in the database
 * @param {string} bookingId - The original booking ID
 * @param {string} userId - The user ID of the payer
 * @param {string} transactionRef - Stripe Session ID or PayPal Order ID
 * @param {string} method - 'stripe' or 'paypal'
 */
const finalizePayment = async (bookingId, userId, transactionRef, method = 'stripe') => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get booking details and lock the row for processing
        const [booking] = await connection.query(
            'SELECT * FROM bookings WHERE id = ? FOR UPDATE',
            [bookingId]
        );

        if (booking.length === 0) {
            throw new Error('Booking not found');
        }

        const b = booking[0];

        // If booking is already booked, just return success (idempotency)
        if (b.status === 'booked') {
            await connection.rollback();
            return { success: true, alreadyProcessed: true };
        }

        // Check if this transaction has already been recorded
        const [existingPayment] = await connection.query(
            'SELECT id FROM payments WHERE transaction_ref = ?',
            [transactionRef]
        );

        if (existingPayment.length > 0) {
            await connection.rollback();
            return { success: true, alreadyProcessed: true, paymentId: existingPayment[0].id };
        }

        // 2. Fetch accepted quotes to get price breakdown
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

        const bookingAmount = parseFloat(b.agreed_price);
        const platformFee = await calculatePlatformFee(bookingAmount, b);
        const totalAmount = bookingAmount + platformFee;

        // 3. Create payment record
        const paymentId = uuidv4();
        await connection.query(`
            INSERT INTO payments (
                id, booking_id, payer_id, amount, carrier_amount, escort_amount, 
                platform_fee, total_amount, method, transaction_ref, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
        `, [
            paymentId,
            bookingId,
            userId,
            bookingAmount,
            carrierAmount,
            escortAmount,
            platformFee,
            totalAmount,
            method,
            transactionRef
        ]);

        // 4. Update booking status
        await connection.query(
            'UPDATE bookings SET status = "booked" WHERE id = ?',
            [bookingId]
        );

        // 5. Update Wallets (Pending Balance)
        if (carrierId && carrierAmount > 0) {
            // Ensure wallet exists (Safe fallback)
            await connection.query(
                'INSERT IGNORE INTO wallets (user_id, balance, pending_balance, currency) VALUES (?, 0.00, 0.00, "USD")',
                [carrierId]
            );

            await connection.query(
                'UPDATE wallets SET pending_balance = pending_balance + ? WHERE user_id = ?',
                [carrierAmount, carrierId]
            );
            await connection.query(`
                INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                VALUES (?, ?, 'booking_pending', 'completed', ?, ?)
            `, [carrierId, carrierAmount, bookingId, `Pending payment for booking ${bookingId}`]);
        }

        if (escortId && escortAmount > 0) {
            // Ensure wallet exists (Safe fallback)
            await connection.query(
                'INSERT IGNORE INTO wallets (user_id, balance, pending_balance, currency) VALUES (?, 0.00, 0.00, "USD")',
                [escortId]
            );

            await connection.query(
                'UPDATE wallets SET pending_balance = pending_balance + ? WHERE user_id = ?',
                [escortAmount, escortId]
            );
            await connection.query(`
                INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                VALUES (?, ?, 'booking_pending', 'completed', ?, ?)
            `, [escortId, escortAmount, bookingId, `Pending payment for escort service on booking ${bookingId}`]);
        }

        // Admin fee wallet logic
        const [adminUser] = await connection.query('SELECT id FROM users WHERE role = "admin" LIMIT 1');
        if (adminUser.length > 0) {
            const adminId = adminUser[0].id;
            
            // Ensure wallet exists (Safe fallback)
            await connection.query(
                'INSERT IGNORE INTO wallets (user_id, balance, pending_balance, currency) VALUES (?, 0.00, 0.00, "USD")',
                [adminId]
            );

            await connection.query(
                'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                [platformFee, adminId]
            );
            await connection.query(`
                INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                VALUES (?, ?, 'fee', 'completed', ?, ?)
            `, [adminId, platformFee, bookingId, `Platform fee for booking ${bookingId}`]);
        }

        // 6. Notify provider(s)
        if (carrierId) {
            await createNotification({
                userId: carrierId,
                type: 'payment_received',
                title: 'Payment Received - Job Confirmed',
                message: `Payment confirmed for ${b.cargo_type} shipment. You can now start the job.`,
                link: '/dashboard/carrier?section=bookings',
                metadata: { bookingId, paymentId }
            });
        }

        await connection.commit();
        return { success: true, paymentId };

    } catch (error) {
        await connection.rollback();
        console.error('Finalize payment error:', error);
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Calculate platform fee based on booking markup percentage or global default
 * @param {number} bookingAmount 
 * @param {object} booking 
 * @returns {Promise<number>}
 */
const calculatePlatformFee = async (bookingAmount, booking) => {
    // If markup_value is null, fall back to global percentage
    if (booking.markup_value === null || booking.markup_value === undefined) {
        const globalPercentage = await settingsService.getPlatformFeePercentage();
        return bookingAmount * globalPercentage;
    }

    // Default to percentage
    const percentage = parseFloat(booking.markup_value) / 100;
    return bookingAmount * percentage;
};

module.exports = { finalizePayment, calculatePlatformFee };
