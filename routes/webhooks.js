const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { finalizePayment } = require('../services/paymentService');
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

module.exports = router;
