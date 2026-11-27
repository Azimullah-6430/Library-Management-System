'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const passport = require('./config/passport');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const bookRoutes = require('./routes/book.routes');
const categoryRoutes = require('./routes/category.routes');
const reportRoutes = require('./routes/report.routes');
const importExportRoutes = require('./routes/importExport.routes');
const smartshelfRoutes = require('./routes/smartshelf.routes');

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false,
  })
);

// ── Cookie Parser ───────────────────────────────────────────────────────────
app.use(cookieParser());

// ── CORS & Private Network Access (PNA) Configuration ───────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Private-Network, Access-Control-Request-Method, Access-Control-Request-Headers'
  );
  // Support Chrome Private Network Access for localhost / 127.0.0.1 / file://
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

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

// ── Universal Health Check Handler ──────────────────────────────────────────
const healthHandler = (_req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  const status = isDbConnected ? 'online' : 'degraded';
  const statusCode = isDbConnected ? 200 : 503;

  res.status(statusCode).json({
    status,
    database: isDbConnected ? 'connected' : 'disconnected',
    api: 'available',
    service: 'Crescent Library Management System API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
app.get('/api/v1/health', healthHandler);

// ── API Routes (Universal prefix compatibility: /api/v1, /api, and root aliases) ──
const API_PREFIX = '/api/v1';

// Auth routes
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

// Catalog routes
app.use(`${API_PREFIX}/books`, bookRoutes);
app.use('/api/books', bookRoutes);
app.use('/books', bookRoutes);

// Category routes
app.use(`${API_PREFIX}/categories`, categoryRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/categories', categoryRoutes);

// Reports & Dashboard routes
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use('/api/reports', reportRoutes);
app.use('/reports', reportRoutes);
app.use(`${API_PREFIX}/dashboard`, reportRoutes);
app.use('/api/dashboard', reportRoutes);
app.use('/dashboard', reportRoutes);

// Import/Export routes
app.use(`${API_PREFIX}/import-export`, importExportRoutes);
app.use('/api/import-export', importExportRoutes);
app.use('/import-export', importExportRoutes);

// SmartShelf AI routes
app.use(`${API_PREFIX}/smartshelf`, smartshelfRoutes);
app.use('/api/smartshelf', smartshelfRoutes);
app.use('/smartshelf', smartshelfRoutes);

// Direct SmartShelf resource aliases (/locations, /copies, /movements, /audits, /scan, /labels, /inventory-counts)
const directSmartShelfHandler = (req, res, next) => {
  if (
    req.path.startsWith('/locations') ||
    req.path.startsWith('/copies') ||
    req.path.startsWith('/movements') ||
    req.path.startsWith('/audits') ||
    req.path.startsWith('/scan') ||
    req.path.startsWith('/resolve-scan') ||
    req.path.startsWith('/labels') ||
    req.path.startsWith('/inventory-counts')
  ) {
    return smartshelfRoutes(req, res, next);
  }
  next();
};

app.use(API_PREFIX, directSmartShelfHandler);
app.use('/api', directSmartShelfHandler);
app.use('/', directSmartShelfHandler);

// ── Frontend Static Files & SPA Fallback ────────────────────────────────────
const frontendCandidates = [
  path.resolve(__dirname, '../../crescent-library-frontend'),
  path.resolve(__dirname, '../crescent-library-frontend'),
  path.resolve(__dirname, '../../public'),
];
const frontendDir = frontendCandidates.find((d) => fs.existsSync(d));

if (frontendDir) {
  app.use(express.static(frontendDir));
}

app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/books') ||
    req.path.startsWith('/categories') ||
    req.path.startsWith('/reports') ||
    req.path.startsWith('/dashboard') ||
    req.path.startsWith('/locations') ||
    req.path.startsWith('/copies') ||
    req.path.startsWith('/movements') ||
    req.path.startsWith('/audits') ||
    req.path.startsWith('/scan') ||
    req.path.startsWith('/labels') ||
    req.path.startsWith('/smartshelf') ||
    req.path.startsWith('/import-export') ||
    req.path.startsWith('/uploads') ||
    req.path === '/health' ||
    req.path === '/api/health'
  ) {
    return next();
  }
  if (frontendDir && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    return res.sendFile(path.join(frontendDir, 'index.html'));
  }
  res.json({
    service: 'Crescent Library Management System API',
    status: 'online',
    health: '/api/health',
    api_docs: '/api/v1',
  });
});

// ── 404 Handler for API Routes ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
