const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { finalizePayment } = require('../services/paymentService');
const paypalService = require('../services/paypalService');

// @route   POST /api/webhooks/webhook
// @desc    Stripe Webhook for payment events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (endpointSecret) {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } else {
            event = JSON.parse(req.body);
            console.warn('⚠️ STRIPE_WEBHOOK_SECRET is not set. Event signature not verified.');
        }
    } catch (err) {
        console.error(`❌ Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const bookingId = session.metadata.bookingId;
        const userId = session.metadata.userId;
        const sessionId = session.id;

        console.log(`🔔 Stripe Payment successful for Booking: ${bookingId}`);

        try {
            await finalizePayment(bookingId, userId, sessionId, 'stripe');
            console.log(`✅ Booking ${bookingId} finalized via Stripe Webhook`);
        } catch (error) {
            console.error(`❌ Stripe Finalization Error: ${error.message}`);
            return res.status(500).json({ error: error.message });
        }
    }

    res.json({ received: true });
});

/**
 * @route   POST /api/webhooks/paypal
 * @desc    PayPal Webhook for payment events
 */
router.post('/paypal', express.json(), async (req, res) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    const body = req.body;

    if (webhookId) {
        const isValid = await paypalService.verifyWebhookSignature(req.headers, body, webhookId);
        if (!isValid) {
            console.error('❌ PayPal Webhook Error: Invalid signature');
            return res.status(400).send('Invalid signature');
        }
    } else {
        console.warn('⚠️ PAYPAL_WEBHOOK_ID is not set. Event signature not verified.');
    }

    const eventType = body.event_type;
    console.log(`🔔 PayPal Event: ${eventType}`);

    try {
        if (eventType === 'CHECKOUT.ORDER.APPROVED') {
            const orderId = body.resource.id;
            const customId = body.resource.purchase_units[0].custom_id;

            if (customId) {
                const { bookingId, userId } = JSON.parse(customId);
                console.log(`🔔 PayPal Order Approved for Booking: ${bookingId}. Capturing now...`);

                const capture = await paypalService.captureOrder(orderId);
                if (capture.status === 'COMPLETED') {
                    await finalizePayment(bookingId, userId, orderId, 'paypal');
                    console.log(`✅ Booking ${bookingId} finalized via PayPal Webhook`);
                }
            }
        } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
            const orderId = body.resource.supplementary_data?.related_ids?.order_id || body.resource.id;
            const customId = body.resource.custom_id;

            if (customId) {
                const { bookingId, userId } = JSON.parse(customId);
                console.log(`🔔 PayPal Payment Captured for Booking: ${bookingId}`);
                await finalizePayment(bookingId, userId, orderId, 'paypal');
                console.log(`✅ Booking ${bookingId} finalized via PayPal Webhook (Capture)`);
            }
        }
    } catch (error) {
        console.error('❌ PayPal Webhook Processing Error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    res.json({ received: true });
});

module.exports = router;
