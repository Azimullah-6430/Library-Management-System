'use strict';
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const email = process.argv[2] || 'e2e.librarian@crescent.education';
  const u = await User.findOne({ email }).select('+password');
  if (!u) {
    console.log(JSON.stringify({ found: false }));
  } else {
    console.log(
      JSON.stringify({
        found: true,
        id: u._id,
        name: u.name,
        email: u.email,
        staffId: u.staffId,
        role: u.role,
        passwordHash: u.password,
        isBcrypt: u.password ? u.password.startsWith('$2') : false,
        createdAt: u.createdAt,
      })
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

