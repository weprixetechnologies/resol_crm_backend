const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const errorHandler = require('./middlewares/errorHandler.middleware');
const ApiResponse = require('./utils/apiResponse');

const app = express();

// Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));

// Robust CORS configuration for production domain (https://crm.cursiveletters.in) and preflight requests
const allowedOrigins = [
  'https://crm.cursiveletters.in',
  'https://apicrm.cursiveletters.in',
  'http://localhost:3000',
  'http://localhost:3001'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(compression()); // Gzip compression
app.use(morgan('dev')); // API analytics & request logging
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json(ApiResponse.success(null, 'Server is healthy'));
});

const authRoutes = require('./modules/auth/auth.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const userRoutes = require('./modules/users/user.routes');
const deletionRoutes = require('./modules/deletions/deletion.routes');
const publicFormRoutes = require('./modules/publicForm/publicForm.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const sessionRoutes = require('./modules/sessions/session.routes');
const importRoutes = require('./modules/import/import.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const mailRoutes = require('./modules/mail/mail.routes');
const campaignRoutes = require('./modules/campaigns/campaign.routes');
const webhookRoutes = require('./modules/webhooks/webhook.routes');

app.use('/api/auth', authRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/users', userRoutes);
app.use('/api/deletions', deletionRoutes);
app.use('/api/public-form', publicFormRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/import', importRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/email', mailRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/webhooks', webhookRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json(ApiResponse.error('NOT_FOUND', 'Endpoint not found'));
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
