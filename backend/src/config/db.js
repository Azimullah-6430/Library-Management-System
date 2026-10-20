const mongoose = require('mongoose');
const dns = require('dns');

// On Windows, Node's c-ares DNS resolver can fail with querySrv ECONNREFUSED on local ISP DNS
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // Ignore if custom DNS cannot be set
}

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/crescent-library';

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`✅  MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('❌  MongoDB connection error:', err.message);
    console.warn('⚠️   Server will start, but database operations require a running MongoDB instance or connection string.');
    // Retry connection in background every 5 seconds
    setTimeout(connectDB, 5000);
  }

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('⚠️   MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    isConnected = true;
    console.log('✅  MongoDB reconnected');
  });
};

module.exports = connectDB;
