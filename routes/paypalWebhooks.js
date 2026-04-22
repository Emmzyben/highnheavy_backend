const express = require('express');
const router = express.Router();
const paypalService = require('../services/paypalService');
const { finalizePayment } = require('../services/paymentService');

// @route   POST /api/webhooks/paypal
// @desc    PayPal Webhook for payment events
router.post('/', async (req, res) => {
    try {
        const headers = req.headers;
        const body = req.body;
        const webhookId = process.env.PAYPAL_WEBHOOK_ID;

        console.log('🔔 PayPal Webhook Received:', body.event_type);

        // 1. Verify webhook signature
        if (webhookId) {
            const isValid = await paypalService.verifyWebhookSignature(headers, body, webhookId);
            if (!isValid) {
                console.error('❌ PayPal Webhook Signature Verification Failed');
                return res.status(400).send('Invalid signature');
            }
        } else {
            console.warn('⚠️ PAYPAL_WEBHOOK_ID is not set. Event signature not verified.');
        }

        // 2. Handle specific events
        const eventType = body.event_type;
        const resource = body.resource;

        if (eventType === 'CHECKOUT.ORDER.APPROVED') {
            // User approved the payment, but it's not captured yet
            const orderId = resource.id;
            
            let bookingId, userId;
            try {
                const customIdStr = resource.purchase_units[0].custom_id;
                const parsed = JSON.parse(customIdStr);
                bookingId = parsed.bookingId;
                userId = parsed.userId;
            } catch (e) {
                console.error('❌ PayPal Webhook: Could not parse custom_id', resource.purchase_units[0].custom_id);
                return res.status(400).send('Invalid custom_id');
            }

            console.log(`🔄 PayPal Webhook: Capturing APPROVED order ${orderId} for Booking ${bookingId}`);

            try {
                // Try to capture. If already captured by frontend, this will fail gracefully.
                const capture = await paypalService.captureOrder(orderId);
                if (capture.status === 'COMPLETED') {
                    await finalizePayment(bookingId, userId, orderId, 'paypal');
                    console.log(`✅ PayPal Webhook: Order ${orderId} captured and finalized`);
                }
            } catch (error) {
                // If it fails because it's already captured, check if we need to finalize
                if (error.message.includes('ORDER_ALREADY_CAPTURED') || error.message.includes('422')) {
                    console.log(`ℹ️ PayPal Webhook: Order ${orderId} was already captured.`);
                    // finalizePayment is idempotent, so we can call it just in case
                    await finalizePayment(bookingId, userId, orderId, 'paypal');
                } else {
                    console.error('❌ PayPal Webhook Capture Error:', error.message);
                }
            }
        } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
            // Capture already happened (maybe by frontend)
            // We can finalize here too if not already done
            const orderId = resource.supplementary_data?.related_ids?.order_id || resource.id;
            
            // Note: Capture resource might not have the custom_id easily accessible in the same place
            // It's safer to rely on ORDER.APPROVED for capture initiation
        }

        res.json({ received: true });
    } catch (error) {
        console.error('❌ PayPal Webhook Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
