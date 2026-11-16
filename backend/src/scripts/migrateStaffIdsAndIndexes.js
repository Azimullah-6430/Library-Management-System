'use strict';
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in environment');
    process.exit(1);
  }

  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB Atlas');

  // Step 1: Detect duplicate staffIds
  const users = await User.find({}, 'name email staffId').lean();
  console.log(`Found ${users.length} total user accounts:`);
  users.forEach((u) => console.log(`  - ${u.name} (${u.email}) -> staffId: "${u.staffId || ''}"`));

  const staffIdCounts = {};
  users.forEach((u) => {
    if (u.staffId) {
      staffIdCounts[u.staffId] = (staffIdCounts[u.staffId] || 0) + 1;
    }
  });

  const duplicateStaffIds = Object.keys(staffIdCounts).filter((id) => staffIdCounts[id] > 1);

  if (duplicateStaffIds.length > 0) {
    console.log('\n⚠️ Found duplicate staffIds:', duplicateStaffIds);
    for (const dupId of duplicateStaffIds) {
      const dupUsers = users.filter((u) => u.staffId === dupId);
      console.log(`Resolving duplicates for staffId "${dupId}" (${dupUsers.length} accounts):`);
      // Keep the first one as-is, append unique suffix for subsequent ones
      for (let i = 1; i < dupUsers.length; i++) {
        const newStaffId = `${dupId}-${i + 1}`;
        await User.findByIdAndUpdate(dupUsers[i]._id, { staffId: newStaffId });
        console.log(`  Updated ${dupUsers[i].email} -> new staffId: "${newStaffId}"`);
      }
    }
  } else {
    console.log('✅ No duplicate staffIds found.');
  }

  // Step 2: Ensure Email index is unique
  console.log('\nEnsuring unique index on email...');
  await mongoose.connection.collection('users').createIndex({ email: 1 }, { unique: true, background: true });
  console.log('✅ Unique index on email ensured');

  // Step 3: Ensure Staff ID index is unique and sparse
  console.log('Ensuring unique sparse index on staffId...');
  await mongoose.connection.collection('users').createIndex({ staffId: 1 }, { unique: true, sparse: true, background: true });
  console.log('✅ Unique sparse index on staffId ensured');

  // Step 4: Verify indexes
  const finalIndexes = await mongoose.connection.collection('users').indexes();
  console.log('\nFinal User Collection Indexes:');
  finalIndexes.forEach((idx) => {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${Boolean(idx.unique)}, sparse: ${Boolean(idx.sparse)})`);
  });

  console.log('\n🎉 Safe database migration completed successfully!');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

