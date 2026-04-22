const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for avatar uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/avatars';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

const { uploadToIPFS } = require('../services/pinataService');

// ... imports remain the same ...

// @route   POST /api/users/avatar (Alternative for /api/users/upload-avatar)
router.post(['/avatar', '/upload-avatar'], authMiddleware, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a file' });
        }

        const userId = req.user.id;

        // Upload to Pinata
        console.log('Starting Pinata upload for file:', req.file.originalname);
        const pinataResult = await uploadToIPFS(req.file);
        console.log('Pinata upload complete:', pinataResult);

        // Construct IPFS URL
        let gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
        // Remove https:// if it exists in the gateway string to prevent double protocol
        gateway = gateway.replace(/^https?:\/\//, '');
        const avatarUrl = `https://${gateway}/ipfs/${pinataResult.IpfsHash}`;
        console.log('Generated Avatar URL:', avatarUrl);

        // Update user record
        const [updateResult] = await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
        console.log('Database update result:', updateResult);

        // Clean up local file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error deleting local file:', err);
        });

        res.json({
            success: true,
            message: 'Avatar uploaded successfully',
            url: avatarUrl
        });
    } catch (error) {
        console.error('Avatar upload error:', error);
        // Clean up local file if it exists
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting local file:', err);
            });
        }
        res.status(500).json({ success: false, message: 'Server error uploading avatar' });
    }
});

// @route   GET /api/users/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    console.log('Profile route hit for user:', req.user?.id);
    try {
        const userId = req.user.id;
        const [user] = await pool.query(`
            SELECT 
                u.id, u.email, u.full_name, u.role, u.profile_completed, u.status, u.avatar_url, u.created_at,
                p.company_name, p.contact_person, p.contact_number, p.address, p.city, p.state, p.zip_code, p.bio,
                p.mc_number, p.dot_number, p.fleet_size,
                p.drivers_license_number, p.certification_number, p.years_experience, p.vehicle_details,
                p.service_area, p.vehicle_types, p.insurance_info
            FROM users u
            LEFT JOIN profiles p ON u.id = p.user_id
            WHERE u.id = ?
        `, [userId]);

        if (user.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log('User data loaded:', { id: user[0].id, hasAvatar: !!user[0].avatar_url, avatar: user[0].avatar_url });

        // Remove sensitive data
        if (user[0].password_hash) delete user[0].password_hash;

        res.json({ success: true, data: user[0] });
    } catch (error) {
        console.error('Fetch profile error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
});

// @route   POST /api/users/profile
// @desc    Create or update user profile
// @access  Private
router.post('/profile', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            company_name,
            contact_person,
            contact_number,
            address,
            city,
            state,
            zip_code,
            bio,
            // Carrier specific
            mc_number,
            dot_number,
            fleet_size,
            // Escort specific
            drivers_license_number,
            certification_number,
            years_experience,
            vehicle_details,
            // Shared
            service_area,
            vehicle_types,
            insurance_info
        } = req.body;

        // Check if profile exists
        const [existing] = await pool.query('SELECT user_id FROM profiles WHERE user_id = ?', [userId]);

        const query = existing.length > 0
            ? `UPDATE profiles SET 
                company_name=?, contact_person=?, contact_number=?, address=?, city=?, state=?, zip_code=?, bio=?,
                mc_number=?, dot_number=?, fleet_size=?,
                drivers_license_number=?, certification_number=?, years_experience=?, vehicle_details=?,
                service_area=?, vehicle_types=?, insurance_info=?
               WHERE user_id=?`
            : `INSERT INTO profiles (
                company_name, contact_person, contact_number, address, city, state, zip_code, bio,
                mc_number, dot_number, fleet_size,
                drivers_license_number, certification_number, years_experience, vehicle_details,
                service_area, vehicle_types, insurance_info,
                user_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            company_name, contact_person, contact_number, address, city, state, zip_code, bio,
            mc_number, dot_number, fleet_size,
            drivers_license_number, certification_number, years_experience, vehicle_details,
            service_area, JSON.stringify(vehicle_types || []), JSON.stringify(insurance_info || {}),
            userId
        ];

        await pool.query(query, params);

        // Mark profile as completed in users table
        await pool.query('UPDATE users SET profile_completed = 1 WHERE id = ?', [userId]);

        res.json({ success: true, message: 'Profile saved successfully' });
    } catch (error) {
        console.error('Profile save error:', error);
        res.status(500).json({ success: false, message: 'Server error saving profile' });
    }
});

// @route   PATCH /api/users/notifications
// @desc    Update notification preferences
// @access  Private
router.patch('/notifications', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { emailNotifications, pushNotifications } = req.body;

        const updates = [];
        const params = [];

        if (typeof emailNotifications === 'boolean') {
            updates.push('email_notifications = ?');
            params.push(emailNotifications);
        }

        if (typeof pushNotifications === 'boolean') {
            updates.push('push_notifications = ?');
            params.push(pushNotifications);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No notification settings provided' });
        }

        params.push(userId);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Notification preferences updated' });
    } catch (error) {
        console.error('Update notifications error:', error);
        res.status(500).json({ success: false, message: 'Server error updating notifications' });
    }
});

// @route   GET /api/users/list/:role
// @desc    List users by role (Admin Only)
// @access  Private
router.get('/list/:role', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
        }

        const { role } = req.params;
        const [users] = await pool.query(`
            SELECT u.id, u.email, u.full_name, u.role, u.profile_completed, u.created_at, u.status, u.avatar_url,
                   p.company_name, p.contact_number
            FROM users u
            LEFT JOIN profiles p ON u.id = p.user_id
            WHERE u.role = ?
            ORDER BY u.created_at DESC
        `, [role]);

        res.json({ success: true, data: users });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ success: false, message: 'Server error listing users' });
    }
});

// @route   GET /api/users/:id
// @desc    Get user details (Admin Only)
// @access  Private
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const currentUserId = req.user.id;
        const currentUserRole = req.user.role;

        // Fetch user and profile
        const [user] = await pool.query(`
            SELECT 
                u.id, u.email, u.full_name, u.role, u.profile_completed, u.status, u.created_at, u.avatar_url,
                p.company_name, p.contact_person, p.contact_number, p.address, p.city, p.state, p.zip_code, p.bio,
                p.mc_number, p.dot_number, p.fleet_size,
                p.drivers_license_number, p.certification_number, p.years_experience, p.vehicle_details,
                p.service_area, p.vehicle_types, p.insurance_info
            FROM users u
            LEFT JOIN profiles p ON u.id = p.user_id
            WHERE u.id = ?
        `, [id]);

        if (user.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log(`Fetched profile for ${id}:`, {
            hasAvatar: !!user[0].avatar_url,
            avatar: user[0].avatar_url,
            role: user[0].role
        });

        const targetUser = user[0];

        // Check for shared conversation
        const [sharedConv] = await pool.query(`
            SELECT cp1.conversation_id 
            FROM conversation_participants cp1
            JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.user_id = ? AND cp2.user_id = ?
        `, [currentUserId, id]);
        const hasSharedConversation = sharedConv.length > 0;

        // Authorization logic:
        // 1. Admins can see everyone
        // 2. Users can see their own profile
        // 3. Shippers can see Carriers and Escorts (for matching/booking)
        // 4. Participants in a conversation can see each other
        const isAdmin = currentUserRole === 'admin';
        const isSelf = currentUserId === id;
        const isShipperViewingProvider = currentUserRole === 'shipper' && (targetUser.role === 'carrier' || targetUser.role === 'escort');
        const isProviderViewingShipper = (currentUserRole === 'carrier' || currentUserRole === 'escort') && targetUser.role === 'shipper';

        if (!isAdmin && !isSelf && !isShipperViewingProvider && !isProviderViewingShipper && !hasSharedConversation) {
            return res.status(403).json({ success: false, message: 'Unauthorized to view this profile' });
        }

        res.json({ success: true, data: targetUser });
    } catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching user details' });
    }
});

// @route   PATCH /api/users/:id/status
// @desc    Enable/Disable user (Admin Only)
// @access  Private
router.patch('/:id/status', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
        }

        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'disabled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);

        res.json({ success: true, message: `User status updated to ${status}` });
    } catch (error) {
        console.error('Update user status error:', error);
        res.status(500).json({ success: false, message: 'Server error updating user status' });
    }
});

// @route   PATCH /api/users/password
// @desc    Update user password
// @access  Private
router.patch('/password', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long' });
        }

        // Get current password hash
        const [users] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Verify current password
        const bcrypt = require('bcryptjs');
        const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);

        // Update password
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, userId]);

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({ success: false, message: 'Server error updating password' });
    }
});

// Finalize router
module.exports = router;
