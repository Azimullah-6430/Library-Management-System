'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('./config/passport');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const bookRoutes = require('./routes/book.routes');
const categoryRoutes = require('./routes/category.routes');
const reportRoutes = require('./routes/report.routes');
const importExportRoutes = require('./routes/importExport.routes');

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

// ── CORS Configuration ──────────────────────────────────────────────────────
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// ── Logger ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Body Parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Passport Initialization ─────────────────────────────────────────────────
app.use(passport.initialize());

// ── Static Files (Uploaded Book Covers) ──────────────────────────────────────
const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadDir));

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Crescent Library Management System API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/books`, bookRoutes);
app.use(`${API_PREFIX}/categories`, categoryRoutes);
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use(`${API_PREFIX}/import-export`, importExportRoutes);

// ── Frontend Static Files & SPA Fallback ────────────────────────────────────
const frontendDir = path.resolve(__dirname, '../../crescent-library-frontend');
app.use(express.static(frontendDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ── 404 Handler for API Routes ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
