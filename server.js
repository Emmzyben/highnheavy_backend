const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { testConnection } = require('./config/database');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Routes
app.get('/', (req, res) => {
    res.json({
        message: 'HighnHeavy API Server',
        version: '1.0.0',
        status: 'running',
        diagnostic: 'REV_2026_01_16_V1'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Import routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/notifications', require('./routes/notifications'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

const PORT = process.env.PORT || 5000;

// Start server
const startServer = async () => {
    try {
        // Test database connection
        await testConnection();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
