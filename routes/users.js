const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

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

// @route   GET /api/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const [profiles] = await pool.query('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);

        if (profiles.length === 0) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }

        res.json({ success: true, data: profiles[0] });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
});

module.exports = router;
