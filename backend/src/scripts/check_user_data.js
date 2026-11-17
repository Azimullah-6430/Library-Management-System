'use strict';
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({}, { projection: { name: 1, email: 1, role: 1, staffId: 1 } }).toArray();
  console.log('=== USERS ===');
  console.log(users);

  const bookCreatedBy = await db.collection('books').aggregate([{ $group: { _id: '$createdBy', count: { $sum: 1 } } }]).toArray();
  console.log('=== BOOK createdBy distribution ===');
  console.log(bookCreatedBy);

  const copyCreatedBy = await db.collection('bookcopies').aggregate([{ $group: { _id: '$createdBy', count: { $sum: 1 } } }]).toArray();
  console.log('=== BOOK COPY createdBy distribution ===');
  console.log(copyCreatedBy);

  const auditStartedBy = await db.collection('inventoryaudits').aggregate([{ $group: { _id: '$startedBy', count: { $sum: 1 } } }]).toArray();
  console.log('=== AUDIT startedBy distribution ===');
  console.log(auditStartedBy);

  const movementPerformedBy = await db.collection('bookmovements').aggregate([{ $group: { _id: '$performedBy', count: { $sum: 1 } } }]).toArray();
  console.log('=== MOVEMENT performedBy distribution ===');
  console.log(movementPerformedBy);

  await mongoose.disconnect();
}

check().catch(console.error);

