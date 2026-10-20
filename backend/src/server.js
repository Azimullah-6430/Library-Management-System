'use strict';
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

(async () => {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀  Crescent Library API running on http://localhost:${PORT}`);
    console.log(`📚  API Base    : http://localhost:${PORT}/api/v1`);
    console.log(`❤️   Health Check: http://localhost:${PORT}/health`);
    console.log(`⚙️   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌  Port ${PORT} is busy. Automatically freed by predev script. Try restarting.\n`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
})();
