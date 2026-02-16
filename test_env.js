const dotenv = require('dotenv');
const path = require('path');

console.log('Current directory:', process.cwd());
const result = dotenv.config();

if (result.error) {
    console.error('Error loading .env:', result.error);
} else {
    console.log('Dotenv loaded successfully');
    console.log('Parsed env keys:', Object.keys(result.parsed));
}

console.log('JWT_SECRET from process.env:', process.env.JWT_SECRET);
