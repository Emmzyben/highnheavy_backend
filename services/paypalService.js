const axios = require('axios');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';

const BASE_URL = PAYPAL_MODE === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

/**
 * Get PayPal Access Token
 */
const getAccessToken = async () => {
    try {
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
        const response = await axios.post(
            `${BASE_URL}/v1/oauth2/token`,
            'grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('PayPal Access Token Error:', error.response?.data || error.message);
        throw new Error('Could not authenticate with PayPal');
    }
};

/**
 * Create a PayPal Order
 */
const createOrder = async (bookingId, userId, amount) => {
    try {
        const accessToken = await getAccessToken();
        const response = await axios.post(
            `${BASE_URL}/v2/checkout/orders`,
            {
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        reference_id: bookingId,
                        amount: {
                            currency_code: 'USD',
                            value: amount.toFixed(2)
                        },
                        description: `Booking #${bookingId.substring(0, 8)} Payment`,
                        custom_id: JSON.stringify({ bookingId, userId })
                    }
                ],
                application_context: {
                    return_url: `${process.env.FRONTEND_URL}/dashboard/shipper?section=payments&payment_success=true&provider=paypal`,
                    cancel_url: `${process.env.FRONTEND_URL}/dashboard/shipper?section=payments&payment_canceled=true`,
                    brand_name: 'HighnHeavy',
                    user_action: 'PAY_NOW'
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('PayPal Create Order Error:', error.response?.data || error.message);
        throw new Error('Could not create PayPal order');
    }
};

/**
 * Capture a PayPal Order
 */
const captureOrder = async (orderId) => {
    try {
        const accessToken = await getAccessToken();
        const response = await axios.post(
            `${BASE_URL}/v2/checkout/orders/${orderId}/capture`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('PayPal Capture Order Error:', error.response?.data || error.message);
        throw new Error('Could not capture PayPal order');
    }
};

/**
 * Get a PayPal Order
 */
const getOrder = async (orderId) => {
    try {
        const accessToken = await getAccessToken();
        const response = await axios.get(
            `${BASE_URL}/v2/checkout/orders/${orderId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('PayPal Get Order Error:', error.response?.data || error.message);
        throw new Error('Could not get PayPal order');
    }
};

/**
 * Verify PayPal Webhook Signature
 */
const verifyWebhookSignature = async (headers, body, webhookId) => {
    try {
        const accessToken = await getAccessToken();
        const response = await axios.post(
            `${BASE_URL}/v1/notifications/verify-webhook-signature`,
            {
                transmission_id: headers['paypal-transmission-id'],
                transmission_time: headers['paypal-transmission-time'],
                cert_url: headers['paypal-cert-url'],
                auth_algo: headers['paypal-auth-algo'],
                transmission_sig: headers['paypal-transmission-sig'],
                webhook_id: webhookId,
                webhook_event: body
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.verification_status === 'SUCCESS';
    } catch (error) {
        console.error('PayPal Webhook Verification Error:', error.response?.data || error.message);
        return false;
    }
};

module.exports = {
    createOrder,
    captureOrder,
    getOrder,
    verifyWebhookSignature
};
