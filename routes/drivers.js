const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToIPFS } = require('../services/pinataService');

// Configure multer for delivery photos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/deliveries';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'delivery-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per photo
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// @route   GET /api/drivers
// @desc    Get all drivers for the logged-in carrier
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const carrierId = req.user.id;

        // Verify user is a carrier
        if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query(
            `SELECT d.*, u.avatar_url 
             FROM drivers d 
             LEFT JOIN users u ON d.user_id = u.id 
             WHERE d.employer_id = ? 
             ORDER BY d.name ASC`,
            [carrierId]
        );

        res.json({
            success: true,
            data: drivers
        });
    } catch (error) {
        console.error('Fetch drivers error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching drivers' });
    }
});

// @route   GET /api/drivers/provider/:providerId
// @desc    Get all drivers for a specific provider (used for profile viewing)
// @access  Private
router.get('/provider/:providerId', authMiddleware, async (req, res) => {
    try {
        const { providerId } = req.params;

        const [drivers] = await pool.query(
            `SELECT d.id, d.name, d.email, d.phone, d.license_number, d.status, d.completed_jobs, u.avatar_url 
             FROM drivers d 
             LEFT JOIN users u ON d.user_id = u.id 
             WHERE d.employer_id = ? 
             ORDER BY d.name ASC`,
            [providerId]
        );

        res.json({
            success: true,
            data: drivers
        });
    } catch (error) {
        console.error('Fetch provider drivers error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching provider drivers' });
    }
});

// @route   GET /api/drivers/me
// @desc    Get current driver profile and stats
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // Verify user is a driver
        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query(
            `SELECT d.*, p.company_name as employer_name 
             FROM drivers d 
             LEFT JOIN profiles p ON d.employer_id = p.user_id 
             WHERE d.user_id = ?`,
            [userId]
        );

        if (drivers.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver profile not found' });
        }

        res.json({
            success: true,
            data: drivers[0]
        });
    } catch (error) {
        console.error('Fetch driver profile error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
});

// @route   POST /api/drivers
// @desc    Add a new driver
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const carrierId = req.user.id;
        const { name, email, phone, license, licenseExpiry, password } = req.body;

        if (req.user.role !== 'carrier') {
            return res.status(403).json({ success: false, message: 'Only carriers can add drivers' });
        }

        if (!name || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        await connection.beginTransaction();

        // 1. Check if user already exists
        const [existingUser] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'A user with this email already exists' });
        }

        // 2. Create user account for driver
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const userId = uuidv4();

        await connection.query(
            'INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
            [userId, email, password_hash, name, 'driver']
        );

        // 3. Create driver profile
        const driverId = uuidv4();
        await connection.query(
            'INSERT INTO drivers (id, user_id, employer_id, name, email, phone, license_number, license_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [driverId, userId, carrierId, name, email, phone, license, licenseExpiry || null]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Driver added successfully',
            data: { id: driverId, userId, name, email }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Add driver error:', error);
        res.status(500).json({ success: false, message: 'Server error adding driver' });
    } finally {
        connection.release();
    }
});

// @route   PUT /api/drivers/:id
// @desc    Update a driver
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const carrierId = req.user.id;
        const { name, email, phone, license, licenseExpiry, status, password } = req.body;

        // Check if driver belongs to this carrier
        const [existingDriver] = await pool.query(
            'SELECT * FROM drivers WHERE id = ? AND employer_id = ?',
            [id, carrierId]
        );

        if (existingDriver.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found or unauthorized' });
        }

        await pool.query(
            'UPDATE drivers SET name = ?, email = ?, phone = ?, license_number = ?, license_expiry = ?, status = ? WHERE id = ?',
            [name, email, phone, license, licenseExpiry || null, status || existingDriver[0].status, id]
        );

        // Also update users table if email, name, or password changed
        if (existingDriver[0].user_id) {
            let updateFields = ['full_name = ?', 'email = ?'];
            let params = [name, email];

            if (password) {
                const salt = await bcrypt.genSalt(10);
                const password_hash = await bcrypt.hash(password, salt);
                updateFields.push('password_hash = ?');
                params.push(password_hash);
            }

            params.push(existingDriver[0].user_id);
            await pool.query(
                `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
                params
            );
        }

        res.json({
            success: true,
            message: 'Driver updated successfully'
        });
    } catch (error) {
        console.error('Update driver error:', error);
        res.status(500).json({ success: false, message: 'Server error updating driver' });
    }
});

// @route   DELETE /api/drivers/:id
// @desc    Delete a driver
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const carrierId = req.user.id;

        // Check if driver belongs to this carrier
        const [existingDriver] = await connection.query(
            'SELECT * FROM drivers WHERE id = ? AND employer_id = ?',
            [id, carrierId]
        );

        if (existingDriver.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found or unauthorized' });
        }

        await connection.beginTransaction();

        const userId = existingDriver[0].user_id;

        // 1. Nullify references in bookings and quotes tables to avoid FK constraint failure
        // We do this instead of cascading to preserve the history of records
        await connection.query('UPDATE bookings SET assigned_driver_id = NULL WHERE assigned_driver_id = ?', [id]);
        await connection.query('UPDATE quotes SET driver_id = NULL WHERE driver_id = ?', [id]);

        // 2. Delete driver profile
        await connection.query('DELETE FROM drivers WHERE id = ?', [id]);

        // 3. Delete user account
        if (userId) {
            await connection.query('DELETE FROM users WHERE id = ?', [userId]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Driver deleted successfully'
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Delete driver error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting driver' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/drivers/available-loads
// @desc    Get loads assigned to the driver but not yet started
// @access  Private
router.get('/available-loads', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        // Get driver record
        const [drivers] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) return res.status(404).json({ success: false, message: 'Driver not found' });
        const driverId = drivers[0].id;

        const [loads] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name, p.company_name as shipper_company
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            WHERE b.assigned_driver_id = ? AND b.status = 'booked'
            ORDER BY b.created_at DESC
        `, [driverId]);

        res.json({ success: true, data: loads });
    } catch (error) {
        console.error('Fetch available loads error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching available loads' });
    }
});

// @route   GET /api/drivers/active-trip
// @desc    Get the current active trip for the driver
// @access  Private
router.get('/active-trip', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) return res.status(404).json({ success: false, message: 'Driver not found' });
        const driverId = drivers[0].id;

        const [trips] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name, p.company_name as shipper_company, u.phone_number as shipper_phone
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            WHERE b.assigned_driver_id = ? AND b.status = 'in_transit'
            LIMIT 1
        `, [driverId]);

        res.json({ success: true, data: trips.length > 0 ? trips[0] : null });
    } catch (error) {
        console.error('Fetch active trip error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching active trip' });
    }
});

// @route   GET /api/drivers/history
// @desc    Get completed loads for the driver
// @access  Private
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) return res.status(404).json({ success: false, message: 'Driver not found' });
        const driverId = drivers[0].id;

        const [history] = await pool.query(`
            SELECT b.*, u.full_name as shipper_name, p.company_name as shipper_company
            FROM bookings b
            JOIN users u ON b.shipper_id = u.id
            LEFT JOIN profiles p ON b.shipper_id = p.user_id
            WHERE b.assigned_driver_id = ? AND b.status IN ('delivered', 'completed')
            ORDER BY b.updated_at DESC
        `, [driverId]);

        res.json({ success: true, data: history });
    } catch (error) {
        console.error('Fetch driver history error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching history' });
    }
});

// @route   POST /api/drivers/accept-load/:id
// @desc    Driver accepts a load and starts the trip
// @access  Private
router.post('/accept-load/:id', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.id;
        const bookingId = req.params.id;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await connection.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) return res.status(404).json({ success: false, message: 'Driver profile not found' });
        const driverId = drivers[0].id;

        await connection.beginTransaction();

        // 1. Verify booking is assigned to this driver and is in 'booked' status
        const [bookings] = await connection.query(
            'SELECT id, status FROM bookings WHERE id = ? AND assigned_driver_id = ?',
            [bookingId, driverId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found or not assigned to you' });
        }

        if (bookings[0].status !== 'booked') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Only booked loads can be accepted' });
        }

        // 2. Update booking status to 'in_transit'
        await connection.query('UPDATE bookings SET status = "in_transit" WHERE id = ?', [bookingId]);

        // 3. Update driver status to 'on-job'
        await connection.query('UPDATE drivers SET status = "on-job" WHERE id = ?', [driverId]);

        await connection.commit();

        res.json({ success: true, message: 'Load accepted, trip started' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Accept load error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        connection.release();
    }
});

// @route   PATCH /api/drivers/location
// @desc    Update driver's current location for live tracking
// @access  Private
router.patch('/location', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude, bookingId } = req.body;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await pool.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        const driverId = drivers[0].id;

        // Update driver's current location
        await pool.query(
            'UPDATE drivers SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
            [latitude, longitude, driverId]
        );

        // Optionally update booking location history if bookingId is provided
        if (bookingId) {
            await pool.query(
                `INSERT INTO driver_location_history (driver_id, booking_id, latitude, longitude, recorded_at) 
                 VALUES (?, ?, ?, ?, NOW())`,
                [driverId, bookingId, latitude, longitude]
            );
        }

        res.json({ success: true, message: 'Location updated successfully' });
    } catch (error) {
        console.error('Update location error:', error);
        res.status(500).json({ success: false, message: 'Server error updating location' });
    }
});

// @route   GET /api/drivers/:driverId/location
// @desc    Get driver's current location (for shippers/admin to track)
// @access  Private
router.get('/:driverId/location', authMiddleware, async (req, res) => {
    try {
        const { driverId } = req.params;

        const [drivers] = await pool.query(
            `SELECT d.id, d.name, d.current_latitude, d.current_longitude, d.location_updated_at, d.status
             FROM drivers d
             WHERE d.id = ?`,
            [driverId]
        );

        if (drivers.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        const driver = drivers[0];

        // Get location history (last 50 points)
        const [history] = await pool.query(
            `SELECT latitude, longitude, recorded_at 
             FROM driver_location_history 
             WHERE driver_id = ? 
             ORDER BY recorded_at DESC 
             LIMIT 50`,
            [driverId]
        );

        res.json({
            success: true,
            data: {
                driver: {
                    id: driver.id,
                    name: driver.name,
                    status: driver.status,
                },
                currentLocation: {
                    latitude: driver.current_latitude,
                    longitude: driver.current_longitude,
                    updatedAt: driver.location_updated_at,
                },
                locationHistory: history
            }
        });
    } catch (error) {
        console.error('Get driver location error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching location' });
    }
});


// @route   POST /api/drivers/upload-delivery-photo
// @desc    Upload delivery proof photo
// @access  Private
router.post('/upload-delivery-photo', authMiddleware, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a photo' });
        }

        // Upload to Pinata
        const pinataResult = await uploadToIPFS(req.file);
        const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
        const photoUrl = `https://${gateway}/ipfs/${pinataResult.IpfsHash}`;

        // Clean up local file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error deleting local file:', err);
        });

        res.json({ success: true, url: photoUrl });
    } catch (error) {
        console.error('Delivery photo upload error:', error);
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting local file:', err);
            });
        }
        res.status(500).json({ success: false, message: 'Server error uploading photo' });
    }
});

// @route   POST /api/drivers/complete-load/:id
// @desc    Driver marks a load as delivered
// @access  Private
router.post('/complete-load/:id', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.id;
        const bookingId = req.params.id;
        const { delivery_photos, delivery_signature, receiver_name } = req.body;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const [drivers] = await connection.query('SELECT id FROM drivers WHERE user_id = ?', [userId]);
        if (drivers.length === 0) return res.status(404).json({ success: false, message: 'Driver profile not found' });
        const driverId = drivers[0].id;

        await connection.beginTransaction();

        // 1. Verify booking is assigned to this driver and is in 'in_transit' status
        const [bookings] = await connection.query(
            'SELECT id, status FROM bookings WHERE id = ? AND assigned_driver_id = ?',
            [bookingId, driverId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found or not assigned to you' });
        }

        // 2. Update booking status to 'delivered' and save delivery proof
        await connection.query(
            `UPDATE bookings SET 
                status = "delivered", 
                delivery_photos = ?, 
                delivery_signature = ?, 
                receiver_name = ? 
            WHERE id = ?`,
            [
                JSON.stringify(delivery_photos || []),
                delivery_signature,
                receiver_name,
                bookingId
            ]
        );

        // 3. Update driver status to 'available' and increment completed_jobs
        await connection.query(
            'UPDATE drivers SET status = "available", completed_jobs = completed_jobs + 1 WHERE id = ?',
            [driverId]
        );

        await connection.commit();

        res.json({ success: true, message: 'Load marked as delivered successfully' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Complete load error:', error);
        res.status(500).json({ success: false, message: 'Server error completing load' });
    } finally {
        connection.release();
    }
});

module.exports = router;
