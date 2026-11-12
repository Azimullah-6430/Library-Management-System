'use strict';
require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');

const PORT = parseInt(process.env.PORT, 10) || 5000;

process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception caught:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled Rejection caught:', reason);
});

(async () => {
  await connectDB();

  // Create primary IPv4 server on 0.0.0.0 (serves 127.0.0.1 and all network adapters)
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀  Crescent Library API running on:`);
    console.log(`    - http://localhost:${PORT}`);
    console.log(`    - http://127.0.0.1:${PORT}`);
    console.log(`📚  API Base    : http://localhost:${PORT}/api/v1`);
    console.log(`❤️   Health Check: http://localhost:${PORT}/health`);
    console.log(`⚙️   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌  Port ${PORT} is busy. Please close any existing server process.\n`);
    } else {
      console.error('Server error:', err);
    }
  });

  // On Windows, bind an auxiliary IPv6 loopback listener on [::1]:PORT so
  // browser requests to "http://localhost:PORT" resolve immediately without delay
  let server6 = null;
  try {
    server6 = http.createServer(app);
    server6.keepAliveTimeout = 65000;
    server6.headersTimeout = 66000;
    server6.listen(PORT, '::1', () => {
      console.log(`🌐  IPv6 Loopback listener active on [::1]:${PORT}`);
    });
    server6.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') {
        console.warn('IPv6 listener notice:', err.message);
      }
    });
  } catch (e) {
    // Silently continue with IPv4
  }

  // Graceful shutdown
  const cleanShutdown = () => {
    console.log('\n🛑  Closing Crescent Library servers...');
    server.close(() => {
      if (server6) {
        server6.close(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', cleanShutdown);
  process.on('SIGTERM', cleanShutdown);
})();
