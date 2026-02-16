const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const uploadToIPFS = async (file) => {
    const PINATA_API_KEY = process.env.PINATA_API_KEY;
    const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
    const PINATA_JWT = process.env.PINATA_JWT;

    // Check if configuration is missing
    const isConfigured = PINATA_JWT || (PINATA_API_KEY && PINATA_SECRET_KEY);

    if (!isConfigured) {
        console.warn('⚠️ Pinata IPFS is not configured. Falling back to local storage.');
        if (process.env.NODE_ENV === 'development') {
            // In dev, we can just return the local file path as a fallback
            // Assuming the server serves 'uploads' folder
            return {
                IpfsHash: `local-fallback-${Date.now()}`,
                localUrl: `/uploads/temp/${file.filename}`,
                isFallback: true
            };
        }
        throw new Error('Pinata API keys are missing. Please check your .env file.');
    }

    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(file.path));

        const metadata = JSON.stringify({
            name: file.originalname,
        });
        formData.append('pinataMetadata', metadata);

        const options = JSON.stringify({
            cidVersion: 0,
        });
        formData.append('pinataOptions', options);

        const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
            maxBodyLength: 'Infinity',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                ...(PINATA_JWT
                    ? { 'Authorization': `Bearer ${PINATA_JWT}` }
                    : {
                        'pinata_api_key': String(PINATA_API_KEY),
                        'pinata_secret_api_key': String(PINATA_SECRET_KEY)
                    }
                )
            }
        });

        return response.data;
    } catch (error) {
        console.error('Pinata upload error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to upload image to IPFS');
    }
};

module.exports = { uploadToIPFS };
