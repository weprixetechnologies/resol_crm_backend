const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const errorHandler = require('./middlewares/errorHandler.middleware');
const ApiResponse = require('./utils/apiResponse');

const app = express();

// Middlewares
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
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
app.use('/api/campaigns', campaignRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json(ApiResponse.error('NOT_FOUND', 'Endpoint not found'));
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
