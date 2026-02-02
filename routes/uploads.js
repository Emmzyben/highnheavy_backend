const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const { uploadToIPFS } = require('../services/pinataService');

// Configure multer for temporary storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/temp';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// @route   POST /api/uploads/image
// @desc    Upload an image to Pinata IPFS
// @access  Private
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a file' });
        }

        // Upload to Pinata
        const pinataResult = await uploadToIPFS(req.file);

        // Construct IPFS URL
        const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
        const imageUrl = `https://${gateway}/ipfs/${pinataResult.IpfsHash}`;

        // Clean up local temp file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error deleting local temp file:', err);
        });

        res.json({
            success: true,
            message: 'Image uploaded successfully',
            url: imageUrl
        });
    } catch (error) {
        console.error('IPFS upload error:', error);
        // Clean up local file if it exists
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting local temp file:', err);
            });
        }
        res.status(500).json({ success: false, message: 'Server error uploading to IPFS' });
    }
});

module.exports = router;
