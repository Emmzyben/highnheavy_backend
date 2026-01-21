const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const {
    generateVerificationToken,
    sendVerificationEmail,
    sendPasswordResetEmail
} = require('../services/email');

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, role, phone_number } = req.body;

        // Validation
        if (!email || !password || !full_name || !role) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        // Check if user already exists
        const [existingUser] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
        const password_hash = await bcrypt.hash(password, salt);

        // Generate verification token
        const verificationToken = generateVerificationToken();

        // Insert user (MySQL will auto-generate UUID)
        const [result] = await pool.query(
            'INSERT INTO users (email, phone_number, password_hash, full_name, role, verification_token, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, phone_number, password_hash, full_name, role, verificationToken, false]
        );

        // Send verification email
        await sendVerificationEmail(email, verificationToken);

        // Get the newly created user
        const [newUser] = await pool.query(
            'SELECT id, email, full_name, role FROM users WHERE id = (SELECT id FROM users WHERE email = ? LIMIT 1)',
            [email]
        );

        const user = newUser[0];

        // Create JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role,
                    profile_completed: false,
                    email_verified: false
                }
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // Check if user exists
        const [users] = await pool.query(
            'SELECT id, email, password_hash, full_name, role, status, profile_completed, email_verified FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const user = users[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const profile_completed = user.profile_completed === 1;

        // Create JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role,
                    status: user.status,
                    profile_completed,
                    email_verified: user.email_verified === 1 || user.email_verified === true
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});

// @route   POST /api/auth/verify-email
// @desc    Verify user email
// @access  Public
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: 'Invalid token' });
        }

        const [users] = await pool.query(
            'SELECT id FROM users WHERE verification_token = ?',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or expired verification token' });
        }

        await pool.query(
            'UPDATE users SET email_verified = true, verification_token = NULL WHERE id = ?',
            [users[0].id]
        );

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const [users] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            // Don't reveal if user exists
            return res.json({ success: true, message: 'If account exists, reset email sent' });
        }

        const resetToken = generateVerificationToken(); // Reusing the random string generator
        const expiry = new Date(Date.now() + 3600000); // 1 hour

        await pool.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
            [resetToken, expiry, users[0].id]
        );

        await sendPasswordResetEmail(email, resetToken);

        res.json({ success: true, message: 'If account exists, reset email sent' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Token and new password required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }

        // Check token and expiry
        const [users] = await pool.query(
            'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword, salt);

        await pool.query(
            'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
            [password_hash, users[0].id]
        );

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/resend-verification
// @desc    Resend verification email
// @access  Public
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email required' });
        }

        const [users] = await pool.query(
            'SELECT id, email_verified, verification_token FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            // Generic message for security
            return res.json({ success: true, message: 'If account exists and is unverified, email sent' });
        }

        const user = users[0];

        if (user.email_verified) {
            return res.status(400).json({ success: false, message: 'Email already verified' });
        }

        let token = user.verification_token;
        if (!token) {
            token = generateVerificationToken();
            await pool.query(
                'UPDATE users SET verification_token = ? WHERE id = ?',
                [token, user.id]
            );
        }

        await sendVerificationEmail(email, token);

        res.json({ success: true, message: 'If account exists and is unverified, email sent' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
