'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');

try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (_) {}

const connectDB = require('../config/db');
const Book = require('../models/Book');
const LibraryLocation = require('../models/LibraryLocation');
const BookCopy = require('../models/BookCopy');
const BookMovement = require('../models/BookMovement');
const User = require('../models/User');
const { formatLocationPayload, formatCopyPayload, generateQrDataUrl } = require('../utils/qrCodeHelper');

const DEFAULT_LOCATIONS = [
  {
    locationCode: 'LIB-G-CS-A1-R1-RW1',
    building: 'Central Library',
    floor: 'Ground Floor',
    section: 'Computer Science & IT',
    shelf: 'A-1',
    rack: 'Rack 1',
    row: 'Row 1',
    description: 'Ground Floor AI, Algorithms & Core Computer Science section',
    capacity: 40,
  },
  {
    locationCode: 'LIB-G-CS-A2-R1-RW2',
    building: 'Central Library',
    floor: 'Ground Floor',
    section: 'Computer Science & IT',
    shelf: 'A-2',
    rack: 'Rack 1',
    row: 'Row 2',
    description: 'Ground Floor Software Engineering & Web Development section',
    capacity: 40,
  },
  {
    locationCode: 'LIB-F1-ENG-B1-R2-RW1',
    building: 'Central Library',
    floor: '1st Floor',
    section: 'Engineering & Technology',
    shelf: 'B-1',
    rack: 'Rack 2',
    row: 'Row 1',
    description: '1st Floor Mechanical & Electrical Engineering collection',
    capacity: 45,
  },
  {
    locationCode: 'LIB-F1-LIT-C1-R3-RW1',
    building: 'Central Library',
    floor: '1st Floor',
    section: 'General & Literature',
    shelf: 'C-1',
    rack: 'Rack 3',
    row: 'Row 1',
    description: '1st Floor Classics, Fiction & Contemporary Literature',
    capacity: 50,
  },
  {
    locationCode: 'LIB-F2-REF-D1-R1-RW1',
    building: 'Central Library',
    floor: '2nd Floor',
    section: 'Reference & Archives',
    shelf: 'D-1',
    rack: 'Rack 1',
    row: 'Row 1',
    description: '2nd Floor Reference manuals, Handbooks & Thesis archives',
    capacity: 30,
  },
];

async function runMigration() {
  console.log('\n=============================================================');
  console.log('📦  SmartShelf AI — Physical Inventory Migration Strategy');
  console.log('=============================================================\n');

  await connectDB();

  // Find an admin user to attribute initial placement
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) admin = await User.findOne({});
  const adminId = admin ? admin._id : null;

  // 1. Seed or verify baseline physical locations
  console.log('📍 [Step 1/3] Verifying 6-Tier Library Physical Locations…');
  let locationsCreated = 0;
  for (const locData of DEFAULT_LOCATIONS) {
    const exists = await LibraryLocation.findOne({ locationCode: locData.locationCode });
    if (!exists) {
      const qrIdentifier = formatLocationPayload(locData.locationCode);
      const qrCodeDataUrl = await generateQrDataUrl(qrIdentifier);
      await LibraryLocation.create({
        ...locData,
        qrIdentifier,
        qrCodeDataUrl,
        createdBy: adminId,
        updatedBy: adminId,
      });
      locationsCreated++;
      console.log(`   [+] Created Location: ${locData.locationCode} (${locData.shelf})`);
    } else {
      console.log(`   [✓] Existing Location: ${locData.locationCode}`);
    }
  }
  console.log(`   Location verification complete. (${locationsCreated} created)\n`);

  // 2. Fetch all existing catalog books
  console.log('📚 [Step 2/3] Migrating Catalog Books into Physical Copies…');
  const books = await Book.find({});
  console.log(`   Found ${books.length} catalog records to evaluate.`);

  let totalCopiesMigrated = 0;
  let totalMovementsRecorded = 0;

  for (const book of books) {
    const copiesCount = Math.max(1, parseInt(book.copies, 10) || 1);
    console.log(`\n   📖 Book: "${book.title}" (ACC: ${book.acc}, Copies: ${copiesCount})`);

    // Match shelf location if exists
    let locationDoc = null;
    if (book.shelf) {
      const cleanShelf = book.shelf.trim().replace(/\s+/g, '-');
      locationDoc = await LibraryLocation.findOne({
        $or: [
          { shelf: new RegExp(`^${book.shelf.trim()}$`, 'i') },
          { shelf: new RegExp(`^${cleanShelf}$`, 'i') },
          { locationCode: new RegExp(cleanShelf, 'i') },
        ],
      });
    }

    if (!locationDoc) {
      // Fallback to Ground Floor A-1 default
      locationDoc = await LibraryLocation.findOne({ locationCode: 'LIB-G-CS-A1-R1-RW1' });
    }

    for (let c = 1; c <= copiesCount; c++) {
      const copyNumPad = String(c).padStart(2, '0');
      const copyId = `${book.acc}-C${copyNumPad}`;

      // Check if copy already exists
      let copyDoc = await BookCopy.findOne({ copyId });
      if (!copyDoc) {
        const accessionNumber = copyId;
        const qrIdentifier = formatCopyPayload(accessionNumber);
        const qrCodeDataUrl = await generateQrDataUrl(qrIdentifier);

        copyDoc = await BookCopy.create({
          copyId,
          bookId: book._id,
          copyNumber: c,
          accessionNumber,
          qrIdentifier,
          qrCodeDataUrl,
          locationId: locationDoc ? locationDoc._id : undefined,
          condition: book.cond || 'Good',
          status: book.status === 'Available' ? 'Available' : book.status || 'Available',
          price: book.price || 0,
          barcode: copyId,
          notes: `Migrated from catalog record ${book.acc}`,
          createdBy: adminId,
          updatedBy: adminId,
        });

        // Record initial placement movement
        await BookMovement.create({
          copyId: copyDoc._id,
          copyIdentifier: copyDoc.copyId,
          bookId: book._id,
          previousLocationId: null,
          previousLocationCode: 'INITIAL_IMPORT',
          newLocationId: locationDoc ? locationDoc._id : null,
          newLocationCode: locationDoc ? locationDoc.locationCode : 'UNASSIGNED',
          performedBy: adminId,
          reason: 'INITIAL_PLACEMENT',
          auditStatus: 'VERIFIED',
          remarks: `Initial SmartShelf migration of physical copy ${copyId}`,
        });

        totalCopiesMigrated++;
        totalMovementsRecorded++;
        console.log(`       [+] Copy #${c}: ${copyId} -> Shelf: ${locationDoc ? locationDoc.shelf : 'Unassigned'} [QR Generated]`);
      } else {
        console.log(`       [✓] Copy #${c}: ${copyId} (Already migrated)`);
      }
    }
  }

  // 3. Update location occupancy counts
  console.log('\n📊 [Step 3/3] Re-calculating Location Occupancy Counters…');
  const allLocations = await LibraryLocation.find({});
  for (const loc of allLocations) {
    const count = await BookCopy.countDocuments({
      locationId: loc._id,
      isDeleted: false,
      status: { $ne: 'Withdrawn' },
    });
    loc.currentCount = count;
    loc.status = count >= loc.capacity ? 'Full' : 'Active';
    await loc.save();
    console.log(`   Location: ${loc.locationCode.padEnd(22)} | Physical Copies: ${count}/${loc.capacity}`);
  }

  console.log('\n=============================================================');
  console.log('✅  SmartShelf AI Migration Completed Successfully!');
  console.log(`   • Locations Created/Verified : ${allLocations.length}`);
  console.log(`   • New Physical Copies Created: ${totalCopiesMigrated}`);
  console.log(`   • Total Historical Movements : ${totalMovementsRecorded}`);
  console.log('=============================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('\n❌ Migration Failed:', err);
  process.exit(1);
});

