'use strict';
const mongoose = require('mongoose');
const LibraryLocation = require('../models/LibraryLocation');
const BookCopy = require('../models/BookCopy');
const BookMovement = require('../models/BookMovement');
const InventoryAudit = require('../models/InventoryAudit');
const InventoryAuditScan = require('../models/InventoryAuditScan');
const Book = require('../models/Book');
const {
  generateOpaqueQrIdentifier,
  generateQrDataUrl,
  generateQrPngBuffer,
  generateQrSvg,
  formatCopyPayload,
  formatLocationPayload,
  parseQrPayload,
} = require('../utils/qrCodeHelper');
const { generateLabelsPdf, LAYOUTS } = require('../utils/labelPdfGenerator');

/**
 * Robust database transaction helper with automatic standalone fallback
 */
const withTransaction = async (workFn) => {
  let session;
  try {
    session = await mongoose.startSession();
  } catch (e) {
    // If sessions not supported
    return await workFn(null);
  }

  let inTx = false;
  try {
    session.startTransaction();
    inTx = true;
    const result = await workFn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (inTx) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    // Fallback if standalone MongoDB without replica set
    if (
      err.message &&
      (err.message.includes('replica set') ||
        err.message.includes('Transaction numbers') ||
        err.code === 20)
    ) {
      return await workFn(null);
    }
    throw err;
  } finally {
    try {
      session.endSession();
    } catch (_) {}
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOCATION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/smartshelf/locations
 * List locations with optional 6-tier hierarchical and occupancy filtering
 */
exports.getLocations = async (req, res, next) => {
  try {
    const { building, floor, section, shelf, rack, row, status, active_only, occupancy, q } = req.query;
    const filter = {};

    if (active_only === 'true' || active_only === '1') {
      filter.isActive = true;
    }
    if (status) filter.status = status;
    if (building) filter.building = { $regex: building.trim(), $options: 'i' };
    if (floor) filter.floor = { $regex: floor.trim(), $options: 'i' };
    if (section) filter.section = { $regex: section.trim(), $options: 'i' };
    if (shelf) filter.shelf = { $regex: shelf.trim(), $options: 'i' };
    if (rack) filter.rack = { $regex: rack.trim(), $options: 'i' };
    if (row) filter.row = { $regex: row.trim(), $options: 'i' };

    if (q && q.trim()) {
      const term = q.trim();
      filter.$or = [
        { locationCode: { $regex: term, $options: 'i' } },
        { building: { $regex: term, $options: 'i' } },
        { floor: { $regex: term, $options: 'i' } },
        { section: { $regex: term, $options: 'i' } },
        { shelf: { $regex: term, $options: 'i' } },
        { rack: { $regex: term, $options: 'i' } },
        { row: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
      ];
    }

    const locations = await LibraryLocation.find(filter)
      .sort({ building: 1, floor: 1, section: 1, shelf: 1, rack: 1, row: 1 })
      .lean();

    // Attach real-time count of active physical copies
    const locationIds = locations.map((loc) => loc._id);
    const counts = await BookCopy.aggregate([
      {
        $match: {
          locationId: { $in: locationIds },
          isDeleted: false,
          status: { $ne: 'Withdrawn' },
        },
      },
      {
        $group: {
          _id: '$locationId',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map();
    counts.forEach((c) => countMap.set(c._id.toString(), c.count));

    let enriched = locations.map((loc) => {
      const currentCount = countMap.get(loc._id.toString()) || 0;
      const capacity = loc.capacity || 40;
      return {
        ...loc,
        id: loc._id.toString(),
        currentCount,
        capacity,
        occupancyPercentage: Math.min(100, Math.round((currentCount / capacity) * 100)),
        isEmpty: currentCount === 0,
        isOccupied: currentCount > 0,
        isFull: currentCount >= capacity,
      };
    });

    // Apply empty / occupied filter
    if (occupancy === 'empty') {
      enriched = enriched.filter((loc) => loc.currentCount === 0);
    } else if (occupancy === 'occupied') {
      enriched = enriched.filter((loc) => loc.currentCount > 0);
    }

    res.json({
      success: true,
      total: enriched.length,
      locations: enriched,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/locations/meta
 * Distinct values across the 6-tier hierarchy for dropdowns & filters
 */
exports.getLocationMeta = async (req, res, next) => {
  try {
    const [buildings, floors, sections, shelves, racks, rows] = await Promise.all([
      LibraryLocation.distinct('building', { isActive: true }),
      LibraryLocation.distinct('floor', { isActive: true }),
      LibraryLocation.distinct('section', { isActive: true }),
      LibraryLocation.distinct('shelf', { isActive: true }),
      LibraryLocation.distinct('rack', { isActive: true }),
      LibraryLocation.distinct('row', { isActive: true }),
    ]);

    res.json({
      success: true,
      data: {
        buildings: buildings.filter(Boolean).sort(),
        floors: floors.filter(Boolean).sort(),
        sections: sections.filter(Boolean).sort(),
        shelves: shelves.filter(Boolean).sort(),
        racks: racks.filter(Boolean).sort(),
        rows: rows.filter(Boolean).sort(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/locations/tree
 * Full nested 6-tier location hierarchy with capacity and real-time copy counts
 */
exports.getLocationTree = async (req, res, next) => {
  try {
    const locations = await LibraryLocation.find()
      .sort({ building: 1, floor: 1, section: 1, shelf: 1, rack: 1, row: 1 })
      .lean();

    const locationIds = locations.map((loc) => loc._id);
    const counts = await BookCopy.aggregate([
      {
        $match: {
          locationId: { $in: locationIds },
          isDeleted: false,
          status: { $ne: 'Withdrawn' },
        },
      },
      {
        $group: {
          _id: '$locationId',
          count: { $sum: 1 },
        },
      },
    ]);
    const countMap = new Map();
    counts.forEach((c) => countMap.set(c._id.toString(), c.count));

    const tree = [];
    const buildingMap = new Map();

    for (const loc of locations) {
      const currentCount = countMap.get(loc._id.toString()) || 0;
      const capacity = loc.capacity || 40;
      const enrichedLoc = {
        ...loc,
        id: loc._id.toString(),
        currentCount,
        capacity,
        occupancyPercentage: Math.min(100, Math.round((currentCount / capacity) * 100)),
        isEmpty: currentCount === 0,
        isOccupied: currentCount > 0,
        isFull: currentCount >= capacity,
      };

      const bName = loc.building || 'Central Library';
      if (!buildingMap.has(bName)) {
        const bNode = { name: bName, floors: [], floorMap: new Map(), totalCount: 0, totalCapacity: 0, totalLocations: 0 };
        buildingMap.set(bName, bNode);
        tree.push(bNode);
      }
      const bNode = buildingMap.get(bName);
      bNode.totalCount += currentCount;
      bNode.totalCapacity += capacity;
      bNode.totalLocations += 1;

      const fName = loc.floor || 'Floor 1';
      if (!bNode.floorMap.has(fName)) {
        const fNode = { name: fName, sections: [], sectionMap: new Map(), totalCount: 0, totalCapacity: 0, totalLocations: 0 };
        bNode.floorMap.set(fName, fNode);
        bNode.floors.push(fNode);
      }
      const fNode = bNode.floorMap.get(fName);
      fNode.totalCount += currentCount;
      fNode.totalCapacity += capacity;
      fNode.totalLocations += 1;

      const sName = loc.section || 'General';
      if (!fNode.sectionMap.has(sName)) {
        const sNode = { name: sName, shelves: [], shelfMap: new Map(), totalCount: 0, totalCapacity: 0, totalLocations: 0 };
        fNode.sectionMap.set(sName, sNode);
        fNode.sections.push(sNode);
      }
      const sNode = fNode.sectionMap.get(sName);
      sNode.totalCount += currentCount;
      sNode.totalCapacity += capacity;
      sNode.totalLocations += 1;

      const shName = loc.shelf || 'Shelf 1';
      if (!sNode.shelfMap.has(shName)) {
        const shNode = { name: shName, racks: [], rackMap: new Map(), totalCount: 0, totalCapacity: 0, totalLocations: 0 };
        sNode.shelfMap.set(shName, shNode);
        sNode.shelves.push(shNode);
      }
      const shNode = sNode.shelfMap.get(shName);
      shNode.totalCount += currentCount;
      shNode.totalCapacity += capacity;
      shNode.totalLocations += 1;

      const rkName = loc.rack || 'Rack 1';
      if (!shNode.rackMap.has(rkName)) {
        const rkNode = { name: rkName, rows: [], totalCount: 0, totalCapacity: 0, totalLocations: 0 };
        shNode.rackMap.set(rkName, rkNode);
        shNode.racks.push(rkNode);
      }
      const rkNode = shNode.rackMap.get(rkName);
      rkNode.totalCount += currentCount;
      rkNode.totalCapacity += capacity;
      rkNode.totalLocations += 1;

      rkNode.rows.push(enrichedLoc);
    }

    const cleanTree = tree.map((b) => ({
      name: b.name,
      totalCount: b.totalCount,
      totalCapacity: b.totalCapacity,
      totalLocations: b.totalLocations,
      floors: b.floors.map((f) => ({
        name: f.name,
        totalCount: f.totalCount,
        totalCapacity: f.totalCapacity,
        totalLocations: f.totalLocations,
        sections: f.sections.map((s) => ({
          name: s.name,
          totalCount: s.totalCount,
          totalCapacity: s.totalCapacity,
          totalLocations: s.totalLocations,
          shelves: s.shelves.map((sh) => ({
            name: sh.name,
            totalCount: sh.totalCount,
            totalCapacity: sh.totalCapacity,
            totalLocations: sh.totalLocations,
            racks: sh.racks.map((rk) => ({
              name: rk.name,
              totalCount: rk.totalCount,
              totalCapacity: rk.totalCapacity,
              totalLocations: rk.totalLocations,
              rows: rk.rows,
            })),
          })),
        })),
      })),
    }));

    res.json({
      success: true,
      totalLocations: locations.length,
      tree: cleanTree,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/locations/:id
 * Retrieve individual location details, full registered copies list, and recent movements
 */
exports.getLocationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    let location = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      location = await LibraryLocation.findById(id).lean();
    }
    if (!location) {
      location = await LibraryLocation.findOne({ locationCode: id.trim().toUpperCase() }).lean();
    }
    if (!location) {
      return res.status(404).json({ success: false, message: `Location "${id}" not found.` });
    }

    const [copies, recentMovements] = await Promise.all([
      BookCopy.find({
        locationId: location._id,
        isDeleted: false,
        status: { $ne: 'Withdrawn' },
      })
        .populate('bookId', 'title author acc isbn publisher year cat coverImage frontCover price')
        .sort({ copyNumber: 1 })
        .lean(),
      BookMovement.find({
        $or: [{ newLocationId: location._id }, { previousLocationId: location._id }],
      })
        .populate('bookId', 'title acc')
        .populate('performedBy', 'name email role')
        .sort({ timestamp: -1 })
        .limit(20)
        .lean(),
    ]);

    const currentCount = copies.length;
    const capacity = location.capacity || 40;
    const occupancyPercentage = Math.min(100, Math.round((currentCount / capacity) * 100));

    res.json({
      success: true,
      location: {
        ...location,
        id: location._id.toString(),
        currentCount,
        capacity,
        occupancyPercentage,
        isEmpty: currentCount === 0,
        isOccupied: currentCount > 0,
        isFull: currentCount >= capacity,
      },
      copies,
      recentMovements,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/locations
 * Create a new physical location node
 */
exports.createLocation = async (req, res, next) => {
  try {
    const {
      building = 'Central Library',
      floor,
      section,
      shelf,
      rack,
      row,
      description,
      capacity = 40,
    } = req.body;

    if (!floor || !section || !shelf || !rack || !row) {
      return res.status(400).json({
        success: false,
        message: 'Floor, section, shelf, rack, and row are all required to create a location.',
      });
    }

    const clean = (s) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const locationCode = `${clean(building)}-${clean(floor)}-${clean(section)}-${clean(shelf)}-${clean(rack)}-${clean(row)}`;

    const existing = await LibraryLocation.findOne({ locationCode });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Location code "${locationCode}" already exists.`,
        location: existing,
      });
    }

    const qrIdentifier = formatLocationPayload(locationCode);
    const qrCodeDataUrl = await generateQrDataUrl(qrIdentifier);

    const location = await LibraryLocation.create({
      locationCode,
      building: building.trim(),
      floor: floor.trim(),
      section: section.trim(),
      shelf: shelf.trim(),
      rack: rack.trim(),
      row: row.trim(),
      description: (description || '').trim(),
      capacity: Math.max(1, parseInt(capacity, 10) || 40),
      isActive: true,
      status: 'Active',
      qrIdentifier,
      qrCodeDataUrl,
      createdBy: req.user?._id,
      updatedBy: req.user?._id,
    });

    res.status(201).json({
      success: true,
      message: `Location "${locationCode}" created successfully.`,
      location,
      data: location,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/smartshelf/locations/:id
 * Edit location names, 6 tiers, custom codes, properties, or capacity
 */
exports.updateLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const location = await LibraryLocation.findById(id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const {
      building,
      floor,
      section,
      shelf,
      rack,
      row,
      locationCode,
      description,
      capacity,
      status,
      isActive,
    } = req.body;

    let tierChanged = false;
    if (building !== undefined && building.trim() && building.trim() !== location.building) {
      location.building = building.trim();
      tierChanged = true;
    }
    if (floor !== undefined && floor.trim() && floor.trim() !== location.floor) {
      location.floor = floor.trim();
      tierChanged = true;
    }
    if (section !== undefined && section.trim() && section.trim() !== location.section) {
      location.section = section.trim();
      tierChanged = true;
    }
    if (shelf !== undefined && shelf.trim() && shelf.trim() !== location.shelf) {
      location.shelf = shelf.trim();
      tierChanged = true;
    }
    if (rack !== undefined && rack.trim() && rack.trim() !== location.rack) {
      location.rack = rack.trim();
      tierChanged = true;
    }
    if (row !== undefined && row.trim() && row.trim() !== location.row) {
      location.row = row.trim();
      tierChanged = true;
    }

    if (locationCode && locationCode.trim().toUpperCase() !== location.locationCode) {
      const newCode = locationCode.trim().toUpperCase();
      const existing = await LibraryLocation.findOne({ locationCode: newCode, _id: { $ne: location._id } });
      if (existing) {
        return res.status(409).json({ success: false, message: `Location code "${newCode}" is already in use.` });
      }
      location.locationCode = newCode;
      location.qrIdentifier = formatLocationPayload(newCode);
      location.qrCodeDataUrl = await generateQrDataUrl(location.qrIdentifier);
    } else if (tierChanged && !locationCode) {
      const clean = (s) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const autoCode = `${clean(location.building)}-${clean(location.floor)}-${clean(location.section)}-${clean(location.shelf)}-${clean(location.rack)}-${clean(location.row)}`;
      if (autoCode !== location.locationCode) {
        const existing = await LibraryLocation.findOne({ locationCode: autoCode, _id: { $ne: location._id } });
        if (existing) {
          return res.status(409).json({ success: false, message: `Auto-generated location code "${autoCode}" already exists.` });
        }
        location.locationCode = autoCode;
        location.qrIdentifier = formatLocationPayload(autoCode);
        location.qrCodeDataUrl = await generateQrDataUrl(location.qrIdentifier);
      }
    }

    if (description !== undefined) location.description = String(description).trim();
    if (capacity !== undefined) location.capacity = Math.max(1, parseInt(capacity, 10) || 40);
    if (status !== undefined) location.status = status;
    if (isActive !== undefined) {
      location.isActive = Boolean(isActive);
      if (!location.isActive && location.status === 'Active') location.status = 'Inactive';
      if (location.isActive && location.status === 'Inactive') location.status = 'Active';
    }

    location.updatedBy = req.user?._id;
    await location.save();

    res.json({
      success: true,
      message: `Location "${location.locationCode}" updated successfully.`,
      location,
      data: location,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/smartshelf/locations/:id/deactivate
 * Deactivate a location (soft-disable without deleting historical references)
 */
exports.deactivateLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const location = await LibraryLocation.findById(id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    // Safety guard: prevent deactivating location if active physical copies reside there
    const activeCopiesCount = await BookCopy.countDocuments({
      locationId: location._id,
      status: { $nin: ['Lost', 'Discarded'] },
    });

    if (activeCopiesCount > 0 && !req.query.force && !req.body.force) {
      return res.status(400).json({
        success: false,
        message: `Cannot deactivate location "${location.locationCode}" because ${activeCopiesCount} active book copy/copies are assigned to it. Relocate copies before deactivating.`,
        activeCopiesCount,
      });
    }

    location.isActive = false;
    location.status = 'Inactive';
    location.updatedBy = req.user?._id;
    await location.save();

    res.json({
      success: true,
      message: `Location "${location.locationCode}" has been deactivated.`,
      location,
      data: location,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/smartshelf/locations/:id/activate
 */
exports.activateLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const location = await LibraryLocation.findById(id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    location.isActive = true;
    location.status = 'Active';
    location.updatedBy = req.user?._id;
    await location.save();

    res.json({
      success: true,
      message: `Location "${location.locationCode}" has been activated.`,
      location,
      data: location,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/locations/:id/qr
 * Get printable SVG QR code for shelf/location
 */
exports.getLocationQr = async (req, res, next) => {
  try {
    const { id } = req.params;
    const location = await LibraryLocation.findById(id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const payload = location.qrIdentifier || formatLocationPayload(location.locationCode);
    const svg = await generateQrSvg(payload, { width: 260 });

    res.json({
      success: true,
      locationCode: location.locationCode,
      qrIdentifier: payload,
      qrCodeDataUrl: location.qrCodeDataUrl,
      svg,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. BOOK COPIES MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/smartshelf/copies
 * Create one or more physical copies for an existing catalog Book record
 */
exports.createCopies = async (req, res, next) => {
  try {
    const {
      bookId,
      count = 1,
      locationId,
      condition = 'Good',
      status = 'Available',
      price,
      barcode,
      notes,
    } = req.body;

    if (!bookId) {
      return res.status(400).json({ success: false, message: 'Book record reference (bookId) is required.' });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Existing catalog Book record not found.' });
    }

    // Validate location if provided
    let locationDoc = null;
    if (locationId) {
      locationDoc = await LibraryLocation.findById(locationId);
      if (!locationDoc) {
        return res.status(400).json({ success: false, message: 'Provided locationId does not exist.' });
      }
    }

    // Determine highest existing copyNumber for this book
    const existingCopies = await BookCopy.find({ bookId }).sort({ copyNumber: -1 }).limit(1);
    let nextCopyNumber = existingCopies.length > 0 ? existingCopies[0].copyNumber + 1 : 1;

    // Allow per-copy distinct location assignment when creating multiple copies
    let copySpecs = [];
    if (Array.isArray(req.body.items) && req.body.items.length > 0) {
      copySpecs = req.body.items;
    } else if (Array.isArray(req.body.copies) && req.body.copies.length > 0) {
      copySpecs = req.body.copies;
    } else {
      const numCopies = Math.max(1, parseInt(count, 10) || 1);
      for (let i = 0; i < numCopies; i++) {
        copySpecs.push({
          locationId,
          condition,
          status,
          price,
          barcode,
          notes,
        });
      }
    }

    const createdCopies = [];

    await withTransaction(async (session) => {
      for (let i = 0; i < copySpecs.length; i++) {
        const spec = copySpecs[i];
        const copyNum = nextCopyNumber + i;
        const copyNumPad = String(copyNum).padStart(2, '0');
        const copyId = `${book.acc}-C${copyNumPad}`;
        const accessionNumber = copyId;
        const qrIdentifier = generateOpaqueQrIdentifier();
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const qrPayload = formatCopyPayload(qrIdentifier, baseUrl);
        const qrCodeDataUrl = await generateQrDataUrl(qrPayload);

        // Resolve location for this specific copy
        let specLocationDoc = locationDoc;
        if (spec.locationId && spec.locationId !== locationId) {
          specLocationDoc = await LibraryLocation.findById(spec.locationId);
        }

        const copyDoc = new BookCopy({
          copyId,
          bookId: book._id,
          copyNumber: copyNum,
          accessionNumber,
          qrIdentifier,
          qrCodeDataUrl,
          locationId: specLocationDoc ? specLocationDoc._id : undefined,
          condition: spec.condition || condition,
          status: spec.status || status,
          price: spec.price !== undefined ? parseFloat(spec.price) : (price !== undefined ? parseFloat(price) : book.price || 0),
          barcode: spec.barcode || barcode || copyId,
          notes: spec.notes ? spec.notes.trim() : (notes ? notes.trim() : ''),
          createdBy: req.user?._id,
          updatedBy: req.user?._id,
        });

        await copyDoc.save(session ? { session } : {});

        // Record initial placement movement
        const movement = new BookMovement({
          copyId: copyDoc._id,
          copyIdentifier: copyDoc.copyId,
          bookId: book._id,
          previousLocationId: null,
          previousLocationCode: 'ACQUISITION',
          newLocationId: specLocationDoc ? specLocationDoc._id : null,
          newLocationCode: specLocationDoc ? specLocationDoc.locationCode : 'UNASSIGNED',
          performedBy: req.user?._id,
          reason: 'INITIAL_PLACEMENT',
          auditStatus: 'VERIFIED',
          remarks: `Initial registration of copy #${copyNum} for "${book.title}" at ${specLocationDoc ? specLocationDoc.locationCode : 'UNASSIGNED'}.`,
        });

        await movement.save(session ? { session } : {});
        createdCopies.push(copyDoc);
      }

      // Keep Book.copies synchronized
      const totalCopies = await BookCopy.countDocuments({
        bookId: book._id,
        isDeleted: false,
        status: { $ne: 'Withdrawn' },
      }).session(session);

      book.copies = totalCopies;
      await book.save(session ? { session } : {});
    });

    res.status(201).json({
      success: true,
      message: `Successfully created ${createdCopies.length} physical copies for "${book.title}".`,
      count: createdCopies.length,
      copies: createdCopies,
      data: createdCopies,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/books/:bookId/copies
 * List all physical copies belonging to a specific book
 */
exports.getBookCopies = async (req, res, next) => {
  try {
    const { bookId } = req.params;
    const copies = await BookCopy.find({ bookId, isDeleted: false })
      .populate('locationId', 'locationCode building floor section shelf rack row status')
      .populate('lastAuditedBy', 'name email')
      .sort({ copyNumber: 1 })
      .lean();

    res.json({
      success: true,
      total: copies.length,
      copies,
      data: copies,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies
 * List/filter all physical copies across the entire library
 */
exports.getAllCopies = async (req, res, next) => {
  try {
    const {
      q,
      bookId,
      locationId,
      status,
      condition,
      isMisplaced,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = { isDeleted: false };

    if (bookId) filter.bookId = bookId;
    if (locationId) filter.locationId = locationId;
    if (status) filter.status = status;
    if (condition) filter.condition = condition;
    if (isMisplaced === 'true') filter.isMisplaced = true;
    if (isMisplaced === 'false') filter.isMisplaced = false;

    if (q && q.trim()) {
      const term = q.trim();
      filter.$or = [
        { copyId: { $regex: term, $options: 'i' } },
        { accessionNumber: { $regex: term, $options: 'i' } },
        { qrIdentifier: { $regex: term, $options: 'i' } },
        { barcode: { $regex: term, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [total, copies] = await Promise.all([
      BookCopy.countDocuments(filter),
      BookCopy.find(filter)
        .populate('bookId', 'title author acc isbn cat frontCover')
        .populate('locationId', 'locationCode building floor section shelf rack row')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      copies,
      data: copies,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id
 * Retrieve an individual physical copy by ObjectId, copyId, accession, or QR payload
 */
exports.getCopyById = async (req, res, next) => {
  try {
    const { id } = req.params;
    let copy = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      copy = await BookCopy.findById(id);
    }

    if (!copy) {
      const clean = id.trim().toUpperCase();
      copy = await BookCopy.findOne({
        $or: [
          { copyId: clean },
          { accessionNumber: clean },
          { qrIdentifier: clean },
          { qrIdentifier: `CLMS:COPY:${clean}` },
          { barcode: clean },
        ],
      });
    }

    if (!copy) {
      return res.status(404).json({ success: false, message: `Physical copy "${id}" not found.` });
    }

    await copy.populate('bookId', 'title author acc isbn publisher year cat price frontCover backCover');
    await copy.populate('locationId', 'locationCode building floor section shelf rack row capacity status');
    await copy.populate('lastAuditedBy', 'name email');

    res.json({
      success: true,
      copy,
      data: copy,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/smartshelf/copies/:id
 * Update physical copy condition, status, price, notes
 */
exports.updateCopy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const copy = await BookCopy.findById(id);
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const { condition, status, price, notes, barcode } = req.body;

    if (condition) copy.condition = condition;
    if (status) copy.status = status;
    if (price !== undefined) copy.price = parseFloat(price) || 0;
    if (notes !== undefined) copy.notes = String(notes).trim();
    if (barcode) copy.barcode = String(barcode).trim();

    copy.updatedBy = req.user?._id;
    await copy.save();

    res.json({
      success: true,
      message: `Copy "${copy.copyId}" updated successfully.`,
      copy,
      data: copy,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id/location
 * Retrieve current location details for a physical book copy
 */
exports.getCopyLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const copy = mongoose.isValidObjectId(id)
      ? await BookCopy.findById(id).populate('locationId')
      : await BookCopy.findOne({ copyId: id }).populate('locationId');
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    res.json({
      success: true,
      copyId: copy.copyId,
      accessionNumber: copy.accessionNumber,
      status: copy.status,
      isMisplaced: copy.isMisplaced,
      location: copy.locationId || null,
      locationCode: copy.locationId ? copy.locationId.locationCode : 'UNASSIGNED',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id/qr
 * Get printable SVG QR code and spine label data for a copy
 */
exports.getCopyQr = async (req, res, next) => {
  try {
    const { id } = req.params;
    const copy = mongoose.isValidObjectId(id)
      ? await BookCopy.findById(id).populate('bookId', 'title author acc').populate('locationId', 'locationCode')
      : await BookCopy.findOne({ copyId: id }).populate('bookId', 'title author acc').populate('locationId', 'locationCode');
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const payload = copy.qrIdentifier || formatCopyPayload(copy.accessionNumber);
    const svg = await generateQrSvg(payload, { width: 220 });

    res.json({
      success: true,
      copyId: copy.copyId,
      accessionNumber: copy.accessionNumber,
      qrIdentifier: copy.qrIdentifier,
      qrCodeDataUrl: copy.qrCodeDataUrl,
      svg,
      bookTitle: copy.bookId?.title || 'Unknown Title',
      author: copy.bookId?.author || '',
      locationCode: copy.locationId?.locationCode || 'UNASSIGNED',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/copies/:id/regenerate-qr
 * Regenerate damaged/compromised QR code: revokes old identifier and creates new cryptographically random identifier
 */
exports.regenerateCopyQr = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Damaged or compromised physical QR label' } = req.body;

    const copy = await BookCopy.findById(id).populate('bookId', 'title author');
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const oldQrIdentifier = copy.qrIdentifier;

    // Retain history of revoked identifier
    if (!copy.revokedQrIdentifiers) copy.revokedQrIdentifiers = [];
    if (oldQrIdentifier) {
      copy.revokedQrIdentifiers.push({
        qrIdentifier: oldQrIdentifier,
        revokedAt: new Date(),
        revokedBy: req.user?._id,
        reason: reason.trim(),
      });
    }

    // Generate new collision-resistant cryptographic opaque token
    const newQrIdentifier = generateOpaqueQrIdentifier();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const newPayload = formatCopyPayload(newQrIdentifier, baseUrl);
    const newQrDataUrl = await generateQrDataUrl(newPayload);

    copy.qrIdentifier = newQrIdentifier;
    copy.qrCodeDataUrl = newQrDataUrl;
    copy.updatedBy = req.user?._id;
    await copy.save();

    // Log movement/custody audit record
    await BookMovement.create({
      copyId: copy._id,
      copyIdentifier: copy.copyId,
      bookId: copy.bookId?._id || copy.bookId,
      previousLocationId: copy.locationId,
      newLocationId: copy.locationId,
      performedBy: req.user?._id,
      reason: 'AUDIT_RECONCILIATION',
      auditStatus: 'RECONCILED',
      remarks: `Damaged/compromised QR identifier revoked (${oldQrIdentifier}) and replaced with new token (${newQrIdentifier}). Reason: ${reason}`,
    });

    res.json({
      success: true,
      message: `QR identifier successfully regenerated for copy "${copy.copyId}". Previous code has been revoked.`,
      copyId: copy.copyId,
      oldQrIdentifier,
      newQrIdentifier,
      qrCodeDataUrl: copy.qrCodeDataUrl,
      revokedHistoryCount: copy.revokedQrIdentifiers.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id/qr.png
 * Download standalone high-res PNG image
 */
exports.downloadCopyQrPng = async (req, res, next) => {
  try {
    const { id } = req.params;
    const copy = mongoose.isValidObjectId(id)
      ? await BookCopy.findById(id)
      : await BookCopy.findOne({ copyId: id });
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const payload = formatCopyPayload(copy.qrIdentifier || copy.copyId, baseUrl);
    const buffer = await generateQrPngBuffer(payload, { width: 500 });

    if (!buffer) {
      return res.status(500).json({ success: false, message: 'Failed to generate QR PNG.' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${copy.copyId}-qr.png"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id/qr.svg
 * Download standalone SVG vector image
 */
exports.downloadCopyQrSvg = async (req, res, next) => {
  try {
    const { id } = req.params;
    const copy = mongoose.isValidObjectId(id)
      ? await BookCopy.findById(id)
      : await BookCopy.findOne({ copyId: id });
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const payload = formatCopyPayload(copy.qrIdentifier || copy.copyId, baseUrl);
    const svg = await generateQrSvg(payload, { width: 350 });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${copy.copyId}-qr.svg"`);
    res.send(svg);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/labels/pdf
 * Generate printable multi-label PDF sheet for selected copy IDs
 */
exports.generateSelectedLabelsPdf = async (req, res, next) => {
  try {
    const { copyIds, layout = 'sheet_3x8' } = req.body;

    if (!Array.isArray(copyIds) || copyIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of copyIds to generate labels.' });
    }

    const copies = await BookCopy.find({
      $or: [
        { _id: { $in: copyIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } },
        { copyId: { $in: copyIds } },
        { accessionNumber: { $in: copyIds } },
      ],
      isDeleted: false,
    })
      .populate('bookId', 'title author acc')
      .populate('locationId', 'locationCode shelf building')
      .sort({ copyId: 1 });

    if (copies.length === 0) {
      return res.status(404).json({ success: false, message: 'No valid physical copies found for the provided IDs.' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfBuffer = await generateLabelsPdf(copies, { layout, baseUrl });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="crescent-smartshelf-labels-${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/books/:bookId/labels/pdf
 * Generate printable PDF labels for all copies of a book
 */
exports.getBookCopiesLabelsPdf = async (req, res, next) => {
  try {
    const { bookId } = req.params;
    const { layout = 'sheet_3x8' } = req.query;

    const copies = await BookCopy.find({ bookId, isDeleted: false })
      .populate('bookId', 'title author acc')
      .populate('locationId', 'locationCode shelf building')
      .sort({ copyNumber: 1 });

    if (copies.length === 0) {
      return res.status(404).json({ success: false, message: 'No physical copies found for this book.' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfBuffer = await generateLabelsPdf(copies, { layout, baseUrl });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="crescent-labels-book-${bookId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/labels/layouts
 * List available label paper layouts
 */
exports.getLabelLayouts = (_req, res) => {
  res.json({
    success: true,
    layouts: Object.entries(LAYOUTS).map(([k, v]) => ({
      key: k,
      name: v.name,
      pageSize: v.pageSize,
      cols: v.cols,
      rows: v.rows,
      labelsPerPage: v.cols * v.rows,
      labelWidthPt: v.labelWidth,
      labelHeightPt: v.labelHeight,
    })),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. PHYSICAL MOVEMENT & RELOCATION (ACID TRANSACTIONS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/smartshelf/copies/:id/move
 * Move a physical copy to a new location with ACID transaction & permanent movement log
 */
exports.moveCopy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newLocationId, newLocationCode, reason = 'RELOCATION', remarks } = req.body;

    if (!newLocationId && !newLocationCode) {
      return res.status(400).json({
        success: false,
        message: 'Destination location (newLocationId or newLocationCode) is required.',
      });
    }

    // Resolve target location
    let targetLocation = null;
    if (newLocationId && mongoose.Types.ObjectId.isValid(newLocationId)) {
      targetLocation = await LibraryLocation.findById(newLocationId);
    }
    if (!targetLocation && newLocationCode) {
      targetLocation = await LibraryLocation.findOne({
        locationCode: newLocationCode.trim().toUpperCase(),
      });
    }

    if (!targetLocation) {
      return res.status(404).json({ success: false, message: 'Target destination location does not exist.' });
    }

    if (!targetLocation.isActive) {
      return res.status(400).json({
        success: false,
        message: `Target location "${targetLocation.locationCode}" is inactive. Books cannot be relocated here.`,
      });
    }

    // Resolve copy
    let copy = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      copy = await BookCopy.findById(id).populate('locationId');
    }
    if (!copy) {
      const clean = id.trim().toUpperCase();
      copy = await BookCopy.findOne({
        $or: [{ copyId: clean }, { accessionNumber: clean }, { qrIdentifier: clean }],
      }).populate('locationId');
    }

    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const prevLocId = copy.locationId ? copy.locationId._id : null;
    const prevLocCode = copy.locationId ? copy.locationId.locationCode : 'UNASSIGNED';

    // Prevent invalid or duplicate movement operation
    if (prevLocId && prevLocId.toString() === targetLocation._id.toString()) {
      return res.status(400).json({
        success: false,
        message: `Book copy "${copy.copyId}" is already assigned to location "${targetLocation.locationCode}". Duplicate movement operation prevented.`,
      });
    }

    let movementRecord = null;

    // Execute atomic move with transaction
    await withTransaction(async (session) => {
      // 1. Update copy's current location
      copy.locationId = targetLocation._id;
      copy.isMisplaced = false; // Reset misplaced flag once formally relocated
      copy.misplacedDetectedLocationId = undefined;
      copy.updatedBy = req.user?._id;
      await copy.save(session ? { session } : {});

      // 2. Insert immutable movement log
      movementRecord = new BookMovement({
        copyId: copy._id,
        copyIdentifier: copy.copyId,
        bookId: copy.bookId,
        previousLocationId: prevLocId,
        previousLocationCode: prevLocCode,
        newLocationId: targetLocation._id,
        newLocationCode: targetLocation.locationCode,
        timestamp: new Date(),
        performedBy: req.user?._id,
        reason,
        auditStatus: 'VERIFIED',
        remarks: remarks ? remarks.trim() : `Moved from ${prevLocCode} to ${targetLocation.locationCode}`,
      });

      await movementRecord.save(session ? { session } : {});
    });

    res.json({
      success: true,
      message: `Copy "${copy.copyId}" successfully moved to "${targetLocation.locationCode}".`,
      copyId: copy.copyId,
      previousLocation: prevLocCode,
      currentLocation: targetLocation.locationCode,
      movement: movementRecord,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/copies/:id/movements
 * Retrieve complete chain-of-custody movement history for an individual copy
 */
exports.getCopyMovementHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    let copy = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      copy = await BookCopy.findById(id);
    }
    if (!copy) {
      const clean = id.trim().toUpperCase();
      copy = await BookCopy.findOne({
        $or: [{ copyId: clean }, { accessionNumber: clean }],
      });
    }

    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    const movements = await BookMovement.find({ copyId: copy._id })
      .populate('previousLocationId', 'locationCode building floor section shelf rack row')
      .populate('newLocationId', 'locationCode building floor section shelf rack row')
      .populate('performedBy', 'name email role staffId')
      .sort({ timestamp: -1 })
      .lean();

    res.json({
      success: true,
      copyId: copy.copyId,
      accessionNumber: copy.accessionNumber,
      totalMovements: movements.length,
      movements,
      data: movements,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/movements
 * List all library movements across all books (paginated with filters)
 */
exports.getAllMovements = async (req, res, next) => {
  try {
    const { copyId, bookId, reason, page = 1, limit = 25 } = req.query;
    const filter = {};

    if (copyId) filter.copyIdentifier = { $regex: copyId.trim(), $options: 'i' };
    if (bookId) filter.bookId = bookId;
    if (reason) filter.reason = reason;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [total, movements] = await Promise.all([
      BookMovement.countDocuments(filter),
      BookMovement.find(filter)
        .populate('bookId', 'title author acc')
        .populate('previousLocationId', 'locationCode')
        .populate('newLocationId', 'locationCode')
        .populate('performedBy', 'name email role')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      movements,
      data: movements,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. INVENTORY COUNTS & REAL-TIME AUDIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/smartshelf/locations/:id/counts
 * Detailed copy inventory counts for a specific location
 */
exports.getLocationInventoryCounts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const location = await LibraryLocation.findById(id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const copies = await BookCopy.find({
      locationId: location._id,
      isDeleted: false,
    })
      .populate('bookId', 'title author acc cat isbn price')
      .lean();

    const countsByStatus = {};
    const countsByCondition = {};
    let misplacedCount = 0;

    copies.forEach((c) => {
      countsByStatus[c.status] = (countsByStatus[c.status] || 0) + 1;
      countsByCondition[c.condition] = (countsByCondition[c.condition] || 0) + 1;
      if (c.isMisplaced) misplacedCount++;
    });

    res.json({
      success: true,
      location: {
        id: location._id.toString(),
        locationCode: location.locationCode,
        building: location.building,
        floor: location.floor,
        section: location.section,
        shelf: location.shelf,
        rack: location.rack,
        row: location.row,
        capacity: location.capacity,
        totalCopies: copies.length,
        occupancyPercentage: Math.min(100, Math.round((copies.length / (location.capacity || 1)) * 100)),
        misplacedCount,
        countsByStatus,
        countsByCondition,
      },
      copies,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/inventory-counts
 * System-wide inventory count distribution by building, floor, and section
 */
exports.getGlobalInventoryCounts = async (req, res, next) => {
  try {
    const [
      totalPhysicalCopies,
      activeLocations,
      totalMovements,
      verifiedLocationCopies,
      unassignedCopies,
      misplacedCopies,
      openInventoryAudits,
      statusCounts,
      recentMovements,
    ] = await Promise.all([
      BookCopy.countDocuments({ isDeleted: false }),
      LibraryLocation.countDocuments({ isActive: true }),
      BookMovement.countDocuments(),
      BookCopy.countDocuments({ isDeleted: false, locationId: { $ne: null }, isMisplaced: false }),
      BookCopy.countDocuments({ isDeleted: false, $or: [{ locationId: null }, { locationId: { $exists: false } }] }),
      BookCopy.countDocuments({ isDeleted: false, isMisplaced: true }),
      InventoryAudit.countDocuments({ status: 'IN_PROGRESS' }),
      BookCopy.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      BookMovement.find()
        .populate('previousLocationId', 'locationCode')
        .populate('newLocationId', 'locationCode')
        .populate('performedBy', 'name')
        .sort({ timestamp: -1 })
        .limit(6)
        .lean(),
    ]);

    const formattedStatusCounts = {};
    statusCounts.forEach((s) => (formattedStatusCounts[s._id] = s.count));

    // Distribution across sections
    const sectionDistribution = await BookCopy.aggregate([
      { $match: { isDeleted: false, locationId: { $ne: null } } },
      {
        $lookup: {
          from: 'librarylocations',
          localField: 'locationId',
          foreignField: '_id',
          as: 'loc',
        },
      },
      { $unwind: '$loc' },
      {
        $group: {
          _id: '$loc.section',
          copies: { $sum: 1 },
          shelvesCount: { $addToSet: '$loc.shelf' },
        },
      },
      {
        $project: {
          section: '$_id',
          copies: 1,
          shelvesCount: { $size: '$shelvesCount' },
        },
      },
      { $sort: { copies: -1 } },
    ]);

    res.json({
      success: true,
      summary: {
        totalPhysicalCopies,
        activeLocations,
        totalMovements,
        verifiedLocationCopies,
        unassignedCopies,
        misplacedCopies,
        openInventoryAudits,
        statusCounts: formattedStatusCounts,
        sectionDistribution,
        recentMovements,
      },
      counts: {
        totalPhysicalCopies,
        activeLocations,
        totalMovements,
        verifiedLocationCopies,
        unassignedCopies,
        misplacedCopies,
        openInventoryAudits,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. LIVE QR RESOLVER & SMART VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/smartshelf/scan
 * Intelligent universal scanner: resolves raw QR input (Book copy or Shelf tag)
 */
exports.resolveScan = async (req, res, next) => {
  try {
    const qrText = (req.body.qrText || req.body.qrCode || req.body.text || req.body.code || '').trim();
    const currentShelfContextId = req.body.currentShelfContextId || req.body.shelfContextId;
    if (!qrText) {
      return res.status(400).json({ success: false, message: 'QR scan text is required.' });
    }

    const parsed = parseQrPayload(qrText);

    // If it's a Shelf Location Tag
    if (parsed.type === 'LOCATION') {
      const location = await LibraryLocation.findOne({
        locationCode: parsed.identifier,
      }).lean();

      if (!location) {
        return res.status(404).json({
          success: false,
          entityType: 'LOCATION',
          message: `Location "${parsed.identifier}" is not registered in the system.`,
        });
      }

      const copiesCount = await BookCopy.countDocuments({
        locationId: location._id,
        isDeleted: false,
      });

      return res.json({
        success: true,
        entityType: 'LOCATION',
        location: {
          ...location,
          id: location._id.toString(),
          currentCount: copiesCount,
        },
      });
    }

    // Check if this QR identifier was revoked
    const cleanId = (parsed.identifier || qrText.trim()).toUpperCase();
    const revokedMatch = await BookCopy.findOne({
      'revokedQrIdentifiers.qrIdentifier': cleanId,
    })
      .populate('bookId', 'title author acc')
      .lean();

    if (revokedMatch) {
      const revokedInfo = revokedMatch.revokedQrIdentifiers.find(
        (r) => r.qrIdentifier === cleanId
      );
      return res.status(409).json({
        success: false,
        isRevoked: true,
        entityType: 'REVOKED_QR',
        message: `⚠️ REVOKED QR CODE: This physical label was revoked on ${revokedInfo?.revokedAt ? new Date(revokedInfo.revokedAt).toLocaleDateString() : 'earlier'} and replaced.`,
        revokedDetails: {
          copyId: revokedMatch.copyId,
          bookTitle: revokedMatch.bookId?.title,
          revokedAt: revokedInfo?.revokedAt,
          reason: revokedInfo?.reason,
        },
      });
    }

    // Resolve Active Physical Book Copy
    const copy = await BookCopy.findOne({
      $or: [
        { qrIdentifier: cleanId },
        { copyId: cleanId },
        { accessionNumber: cleanId },
        { qrIdentifier: formatCopyPayload(cleanId) },
        { barcode: cleanId },
      ],
      isDeleted: false,
    })
      .populate('bookId', 'title author addl addl_authors acc isbn cat publisher year edition lang language format price frontCover backCover notes')
      .populate('locationId', 'locationCode building floor section shelf rack row description capacity status')
      .populate('lastAuditedBy', 'name email staffId')
      .lean();

    if (!copy) {
      return res.status(404).json({
        success: false,
        entityType: 'COPY',
        message: `Book Copy with identifier "${cleanId}" not found.`,
      });
    }

    // Smart Misplacement Check if scanner has a shelf context
    let verification = { isMatched: true, message: 'Book is in its registered location.' };
    if (currentShelfContextId && copy.locationId) {
      const isMatch = copy.locationId._id.toString() === currentShelfContextId.toString();
      if (!isMatch) {
        verification = {
          isMatched: false,
          message: `⚠️ Misplaced Book! Expected on "${copy.locationId.locationCode}", but scanned at this shelf.`,
          expectedLocationCode: copy.locationId.locationCode,
        };
      }
    }

    const isVerified = Boolean(copy.lastAuditedAt);
    const locationAuditNotice = isVerified
      ? `Physically verified on shelf on ${new Date(copy.lastAuditedAt).toLocaleDateString()}`
      : 'Recorded physical shelf location (unverified until physical shelf scan or audit)';

    return res.json({
      success: true,
      entityType: 'COPY',
      copy: {
        ...copy,
        isAuditVerified: isVerified,
        locationAuditNotice,
      },
      verification,
      isMatched: verification.isMatched,
      registeredLocation: copy.locationId,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/copies/:id/verify-audit
 * Mark a physical copy as verified on its current shelf
 */
exports.markAuditVerification = async (req, res, next) => {
  try {
    const { id } = req.params;
    let copy = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      copy = await BookCopy.findById(id).populate('locationId');
    }
    if (!copy) {
      const clean = id.trim().toUpperCase();
      copy = await BookCopy.findOne({
        $or: [{ copyId: clean }, { accessionNumber: clean }, { qrIdentifier: clean }],
      }).populate('locationId');
    }

    if (!copy) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }

    copy.lastAuditedAt = new Date();
    copy.lastAuditedBy = req.user?._id;
    copy.isMisplaced = false;
    copy.misplacedDetectedLocationId = undefined;
    await copy.save();

    // Log verification movement record
    await BookMovement.create({
      copyId: copy._id,
      copyIdentifier: copy.copyId,
      bookId: copy.bookId,
      previousLocationId: copy.locationId ? copy.locationId._id : null,
      previousLocationCode: copy.locationId ? copy.locationId.locationCode : 'UNASSIGNED',
      newLocationId: copy.locationId ? copy.locationId._id : null,
      newLocationCode: copy.locationId ? copy.locationId.locationCode : 'UNASSIGNED',
      performedBy: req.user?._id,
      reason: 'AUDIT_RECONCILIATION',
      auditStatus: 'VERIFIED',
      remarks: 'Verified on registered shelf during SmartShelf scanner verification.',
    });

    res.json({
      success: true,
      message: `Physical volume "${copy.copyId}" marked as physically verified on shelf "${copy.locationId ? copy.locationId.locationCode : 'UNASSIGNED'}".`,
      copy: {
        ...copy.toObject(),
        isAuditVerified: true,
        lastAuditedAt: copy.lastAuditedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/books/find
 * Intelligent book location finder & student discovery
 * Search by title, author, isbn, accession, publisher, category, location, or keyword
 */
exports.findBooks = async (req, res, next) => {
  try {
    const {
      title,
      author,
      isbn,
      acc,
      publisher,
      category,
      cat,
      location,
      q,
      available_only,
      student_mode,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};
    if (title) filter.title = { $regex: title.trim(), $options: 'i' };
    if (author) filter.author = { $regex: author.trim(), $options: 'i' };
    if (isbn) filter.isbn = { $regex: isbn.trim().replace(/[-\s]/g, ''), $options: 'i' };
    if (acc) filter.acc = { $regex: acc.trim(), $options: 'i' };
    if (publisher) filter.publisher = { $regex: publisher.trim(), $options: 'i' };
    const catVal = category || cat;
    if (catVal) filter.cat = { $regex: catVal.trim(), $options: 'i' };

    if (q && q.trim()) {
      const term = q.trim();
      const cleanTerm = term.replace(/[-\s]/g, '');
      filter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { author: { $regex: term, $options: 'i' } },
        { isbn: { $regex: cleanTerm || term, $options: 'i' } },
        { acc: { $regex: term, $options: 'i' } },
        { publisher: { $regex: term, $options: 'i' } },
        { cat: { $regex: term, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [totalBooks, books] = await Promise.all([
      Book.countDocuments(filter),
      Book.find(filter)
        .sort({ title: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    const bookIds = books.map((b) => b._id);

    // Fetch active copies for these books
    const copyFilter = {
      bookId: { $in: bookIds },
      isDeleted: false,
    };
    if (available_only === 'true' || available_only === '1') {
      copyFilter.status = 'Available';
    }

    const allCopies = await BookCopy.find(copyFilter)
      .populate('locationId', 'locationCode building floor section shelf rack row description status isActive')
      .sort({ copyNumber: 1 })
      .lean();

    // Group copies by bookId
    const copiesByBook = new Map();
    allCopies.forEach((c) => {
      const bId = c.bookId.toString();
      if (!copiesByBook.has(bId)) copiesByBook.set(bId, []);
      copiesByBook.get(bId).push(c);
    });

    const isStudentMode = student_mode === 'true' || req.user?.role === 'student';

    const results = books.map((b) => {
      const rawCopies = copiesByBook.get(b._id.toString()) || [];

      const formattedCopies = rawCopies.map((c) => {
        const loc = c.locationId;
        const isVerified = Boolean(c.lastAuditedAt);
        const hierarchyText = loc
          ? `${loc.building || 'Central Library'} › Floor ${loc.floor || '1'} › ${loc.section || 'General'} › Shelf ${loc.shelf || '1'} › Rack ${loc.rack || '1'} › Row ${loc.row || '1'}`
          : 'UNASSIGNED';

        const locationData = {
          locationCode: loc ? loc.locationCode : 'UNASSIGNED',
          building: loc ? loc.building : 'Central Library',
          floor: loc ? loc.floor : '—',
          section: loc ? loc.section : '—',
          shelf: loc ? loc.shelf : '—',
          rack: loc ? loc.rack : '—',
          row: loc ? loc.row : '—',
          hierarchy: hierarchyText,
          status: loc ? loc.status : 'Active',
          recordedLocationNotice: 'Recorded physical location (unverified until physical shelf scan or audit)',
          isAuditVerified: isVerified,
          lastAuditedAt: c.lastAuditedAt || null,
        };

        if (isStudentMode) {
          return {
            copyId: c.copyId,
            copyNumber: c.copyNumber,
            condition: c.condition,
            status: c.status,
            isAvailable: c.status === 'Available',
            location: locationData,
          };
        }

        return {
          id: c._id.toString(),
          copyId: c.copyId,
          copyNumber: c.copyNumber,
          accessionNumber: c.accessionNumber,
          condition: c.condition,
          status: c.status,
          price: c.price,
          qrIdentifier: c.qrIdentifier,
          qrCodeDataUrl: c.qrCodeDataUrl,
          isMisplaced: c.isMisplaced,
          isAvailable: c.status === 'Available',
          lastAuditedAt: c.lastAuditedAt,
          location: locationData,
        };
      });

      const availableCopiesCount = formattedCopies.filter((c) => c.status === 'Available').length;

      const baseBook = {
        _id: b._id,
        id: b._id.toString(),
        title: b.title,
        author: b.author,
        addl_authors: b.addl || b.addl_authors,
        acc: b.acc,
        isbn: b.isbn,
        cat: b.cat,
        publisher: b.publisher,
        year: b.year,
        edition: b.edition,
        lang: b.lang,
        format: b.format,
        frontCover: b.frontCover,
        totalCopies: formattedCopies.length,
        availableCopies: availableCopiesCount,
        hasAvailableCopies: availableCopiesCount > 0,
        copies: formattedCopies,
      };

      if (!isStudentMode) {
        baseBook.price = b.price;
        baseBook.notes = b.notes;
        baseBook.createdAt = b.createdAt;
      }

      return baseBook;
    });

    res.json({
      success: true,
      total: totalBooks,
      page: pageNum,
      pages: Math.ceil(totalBooks / limitNum) || 1,
      isStudentMode,
      books: results,
      data: results,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. INVENTORY AUDIT SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/smartshelf/audits/start
 * Initiate a new shelf inventory audit session
 */
exports.startAudit = async (req, res, next) => {
  try {
    const { locationId, locationCode, scope = 'SHELF', notes } = req.body;

    let targetLocation = null;
    if (locationId) targetLocation = await LibraryLocation.findById(locationId);
    if (!targetLocation && locationCode) {
      targetLocation = await LibraryLocation.findOne({ locationCode: locationCode.trim().toUpperCase() });
    }

    if (!targetLocation) {
      return res.status(404).json({ success: false, message: 'Target shelf location for audit not found.' });
    }

    // Determine target location IDs based on audit scope
    let targetLocationIds = [targetLocation._id];
    const normalizedScope = (scope || 'SHELF').toUpperCase();

    if (normalizedScope === 'BUILDING') {
      const children = await LibraryLocation.find({ building: targetLocation.building, isActive: true }).select('_id');
      targetLocationIds = children.map((c) => c._id);
    } else if (normalizedScope === 'FLOOR') {
      const children = await LibraryLocation.find({
        building: targetLocation.building,
        floor: targetLocation.floor,
        isActive: true,
      }).select('_id');
      targetLocationIds = children.map((c) => c._id);
    } else if (normalizedScope === 'SECTION') {
      const children = await LibraryLocation.find({
        building: targetLocation.building,
        floor: targetLocation.floor,
        section: targetLocation.section,
        isActive: true,
      }).select('_id');
      targetLocationIds = children.map((c) => c._id);
    }

    // Determine all physical copies expected at this location/scope
    const expectedDocs = await BookCopy.find({
      locationId: { $in: targetLocationIds },
      isDeleted: false,
      status: { $nin: ['Withdrawn', 'Lost'] },
    }).populate('bookId', 'title author isbn publisher');

    const expectedCopies = expectedDocs.map((c) => c.copyId);
    const expectedDetails = expectedDocs.map((c) => ({
      copyId: c.copyId,
      bookTitle: c.bookId?.title || 'Unknown Title',
      author: c.bookId?.author || 'Unknown Author',
      accessionNumber: c.accessionNumber,
      condition: c.condition,
      status: c.status,
    }));

    const count = await InventoryAudit.countDocuments();
    const dateStr = new Date().toISOString().slice(0, 7).replace('-', '');
    const auditNumber = `AUD-${dateStr}-${String(count + 1).padStart(4, '0')}`;

    const audit = await InventoryAudit.create({
      auditNumber,
      locationId: targetLocation._id,
      locationCode: targetLocation.locationCode,
      startedBy: req.user?._id,
      startedAt: new Date(),
      status: 'IN_PROGRESS',
      scope: {
        type: normalizedScope,
        building: targetLocation.building,
        floor: targetLocation.floor,
        section: targetLocation.section,
        shelf: targetLocation.shelf,
      },
      expectedCopies,
      expectedDetails,
      scannedCopies: [],
      matchedCopies: [],
      verifiedCopies: [],
      misplacedCopies: [],
      unknownScans: [],
      duplicateScans: [],
      missingCopies: [], // IMPORTANT: Must remain empty while audit is in progress!
      pendingVerificationCopies: [],
      resolutions: [],
      summary: {
        totalExpected: expectedCopies.length,
        totalScanned: 0,
        uniqueScanned: 0,
        verifiedCount: 0,
        matchedCount: 0,
        misplacedCount: 0,
        unknownCount: 0,
        duplicateCount: 0,
        missingCount: 0,
        pendingVerificationCount: 0,
        accuracyRate: expectedCopies.length === 0 ? 100 : 0,
      },
      notes: (notes || '').trim(),
    });

    res.status(201).json({
      success: true,
      message: `Audit session "${auditNumber}" started for ${normalizedScope.toLowerCase()} "${targetLocation.locationCode}".`,
      audit,
      data: audit,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/audits/:auditId/scan
 * Record a book scan during an active audit session
 */
exports.recordAuditScan = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const { qrText, copyIdentifier, accessionNumber, rawInput, qrIdentifier, qrCode, code } = req.body;

    const audit = await InventoryAudit.findById(auditId);
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit session not found.' });
    }
    if (audit.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        message: `Audit session is ${audit.status} and cannot accept scans.`,
      });
    }

    const cleanInput = (rawInput || copyIdentifier || qrText || qrIdentifier || qrCode || code || accessionNumber || '').trim();
    if (!cleanInput) {
      return res.status(400).json({ success: false, message: 'Scan input (QR code or copy ID) is required.' });
    }

    const parsed = parseQrPayload(cleanInput);
    const identifier = parsed.identifier || cleanInput;

    // Look up copy in database
    const copy = await BookCopy.findOne({
      $or: [
        { copyId: identifier },
        { accessionNumber: identifier },
        { qrIdentifier: formatCopyPayload(identifier) },
        { barcode: identifier },
        { copyId: cleanInput },
        { accessionNumber: cleanInput },
        { qrIdentifier: cleanInput },
      ],
      isDeleted: false,
    })
      .populate('bookId', 'title author isbn publisher')
      .populate('locationId');

    // Case 1: UNKNOWN scan (token does not belong to any valid copy in catalog)
    if (!copy) {
      const scanEntry = await InventoryAuditScan.create({
        auditId: audit._id,
        copyId: null,
        copyIdentifier: cleanInput,
        rawInput: cleanInput,
        scannedBy: req.user?._id,
        recordedLocationId: audit.locationId,
        verificationResult: 'UNKNOWN',
        scanTimestamp: new Date(),
        details: { rawInput: cleanInput },
      });

      audit.unknownScans.push({
        rawText: cleanInput,
        scannedAt: new Date(),
        isResolved: false,
      });
      audit.summary.totalScanned += 1;
      audit.summary.unknownCount = audit.unknownScans.length;
      await audit.save();

      return res.status(200).json({
        success: true,
        verificationResult: 'UNKNOWN',
        message: `⚠️ Unknown QR Code: Identifier "${cleanInput}" does not belong to any registered book copy.`,
        copy: null,
        auditSummary: audit.summary,
        scanEntry,
      });
    }

    // Case 2: DUPLICATE scan (same copy already scanned in this session)
    if (audit.scannedCopies.includes(copy.copyId)) {
      const scanEntry = await InventoryAuditScan.create({
        auditId: audit._id,
        copyId: copy._id,
        copyIdentifier: copy.copyId,
        rawInput: cleanInput,
        scannedBy: req.user?._id,
        recordedLocationId: audit.locationId,
        homeLocationId: copy.locationId?._id || copy.locationId,
        verificationResult: 'DUPLICATE',
        scanTimestamp: new Date(),
        details: { note: 'Duplicate scan in active session' },
      });

      const existingDup = audit.duplicateScans.find((d) => d.copyIdentifier === copy.copyId);
      if (existingDup) {
        existingDup.count += 1;
        existingDup.scannedAt = new Date();
      } else {
        audit.duplicateScans.push({
          copyIdentifier: copy.copyId,
          bookTitle: copy.bookId?.title,
          scannedAt: new Date(),
          count: 1,
        });
      }

      audit.summary.totalScanned += 1;
      audit.summary.duplicateCount = audit.duplicateScans.reduce((acc, d) => acc + (d.count || 1), 0);
      await audit.save();

      return res.status(200).json({
        success: true,
        verificationResult: 'DUPLICATE',
        message: `ℹ️ Duplicate scan: Copy "${copy.copyId}" has already been recorded in this session.`,
        copy: {
          copyId: copy.copyId,
          accessionNumber: copy.accessionNumber,
          title: copy.bookId?.title,
          author: copy.bookId?.author,
          status: copy.status,
          condition: copy.condition,
        },
        auditSummary: audit.summary,
        scanEntry,
      });
    }

    // Gather valid location IDs for this audit scope
    let validLocationIds = [audit.locationId.toString()];
    if (audit.scope && audit.scope.type && audit.scope.type !== 'SHELF') {
      const targetLocation = await LibraryLocation.findById(audit.locationId);
      if (targetLocation) {
        const query = { isActive: true, building: targetLocation.building };
        if (audit.scope.type === 'FLOOR' || audit.scope.type === 'SECTION') {
          query.floor = targetLocation.floor;
        }
        if (audit.scope.type === 'SECTION') {
          query.section = targetLocation.section;
        }
        const scopedLocs = await LibraryLocation.find(query).select('_id');
        validLocationIds = scopedLocs.map((l) => l._id.toString());
      }
    }

    const copyLocId = copy.locationId?._id ? copy.locationId._id.toString() : (copy.locationId?.toString() || '');
    const isMatched = validLocationIds.includes(copyLocId);

    // Case 3 & 4: PENDING_VERIFICATION (e.g. damaged/poor physical condition requiring physical inspection)
    const requiresInspection = copy.condition === 'Damaged' || copy.condition === 'Poor';
    if (requiresInspection) {
      const alreadyLogged = audit.pendingVerificationCopies.some((p) => p.copyIdentifier === copy.copyId);
      if (!alreadyLogged) {
        audit.pendingVerificationCopies.push({
          copyIdentifier: copy.copyId,
          bookTitle: copy.bookId?.title,
          author: copy.bookId?.author,
          reason: `Physical condition flagged as "${copy.condition}". Physical inspection required.`,
          scannedAt: new Date(),
          isResolved: false,
        });
      }
    }

    let result = isMatched ? 'VERIFIED' : 'MISPLACED';

    const scanEntry = await InventoryAuditScan.create({
      auditId: audit._id,
      copyId: copy._id,
      copyIdentifier: copy.copyId,
      rawInput: cleanInput,
      scannedBy: req.user?._id,
      recordedLocationId: audit.locationId,
      homeLocationId: copy.locationId?._id || copy.locationId,
      verificationResult: result,
      scanTimestamp: new Date(),
    });

    // Record unique scan
    audit.scannedCopies.push(copy.copyId);

    if (result === 'VERIFIED') {
      if (!audit.matchedCopies.includes(copy.copyId)) {
        audit.matchedCopies.push(copy.copyId);
      }
      audit.verifiedCopies.push({
        copyIdentifier: copy.copyId,
        bookTitle: copy.bookId?.title,
        author: copy.bookId?.author,
        scannedAt: new Date(),
        scanId: scanEntry._id,
      });

      // Update copy audit timestamp and clear any previous misplaced flag
      copy.lastAuditDate = new Date();
      copy.isMisplaced = false;
      copy.misplacedDetectedLocationId = null;
      await copy.save();
    } else {
      // MISPLACED: Flag copy in catalog, DO NOT relocate automatically!
      copy.isMisplaced = true;
      copy.misplacedDetectedLocationId = audit.locationId;
      await copy.save();

      const alreadyMisplaced = audit.misplacedCopies.some((m) => m.copyIdentifier === copy.copyId);
      if (!alreadyMisplaced) {
        audit.misplacedCopies.push({
          copyIdentifier: copy.copyId,
          bookTitle: copy.bookId?.title,
          author: copy.bookId?.author,
          recordedLocationId: copy.locationId?._id || copy.locationId,
          recordedLocationCode: copy.locationId?.locationCode || 'UNASSIGNED',
          foundLocationId: audit.locationId,
          foundLocationCode: audit.locationCode,
          scannedAt: new Date(),
          isResolved: false,
        });
      }
    }

    // Update summary metrics
    audit.summary.totalScanned += 1;
    audit.summary.uniqueScanned = audit.scannedCopies.length;
    audit.summary.verifiedCount = audit.verifiedCopies.length;
    audit.summary.matchedCount = audit.verifiedCopies.length;
    audit.summary.misplacedCount = audit.misplacedCopies.length;
    audit.summary.pendingVerificationCount = audit.pendingVerificationCopies.length;
    audit.summary.accuracyRate =
      audit.summary.totalExpected > 0
        ? Math.round((audit.summary.verifiedCount / audit.summary.totalExpected) * 100)
        : 100;

    await audit.save();

    res.status(200).json({
      success: true,
      verificationResult: result,
      message:
        result === 'VERIFIED'
          ? `✓ Verified: "${copy.copyId}" belongs at this location.`
          : `⚠️ Misplaced: "${copy.copyId}" is registered at "${copy.locationId?.locationCode || 'another location'}"!`,
      copy: {
        copyId: copy.copyId,
        accessionNumber: copy.accessionNumber,
        title: copy.bookId?.title,
        author: copy.bookId?.author,
        status: copy.status,
        condition: copy.condition,
        homeLocationCode: copy.locationId?.locationCode || 'UNASSIGNED',
        currentAuditedLocationCode: audit.locationCode,
      },
      auditSummary: audit.summary,
      scanEntry,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/audits/:auditId/complete
 * Complete audit session
 */
exports.completeAudit = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const audit = await InventoryAudit.findById(auditId).populate('locationId');
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit session not found.' });
    }

    if (audit.status === 'COMPLETED') {
      return res.json({
        success: true,
        message: `Audit session "${audit.auditNumber}" was already completed.`,
        audit,
        data: audit,
      });
    }

    // CRITICAL: Compute missing copies upon finalization
    const missingCopyIds = audit.expectedCopies.filter((id) => !audit.scannedCopies.includes(id));

    // Fetch details for missing copies
    const missingDocs = await BookCopy.find({ copyId: { $in: missingCopyIds } }).populate('bookId', 'title author');
    const missingMap = {};
    missingDocs.forEach((d) => {
      missingMap[d.copyId] = d;
    });

    audit.missingCopies = missingCopyIds.map((cid) => {
      const doc = missingMap[cid];
      const existing = (audit.expectedDetails || []).find((d) => d.copyId === cid);
      return {
        copyIdentifier: cid,
        bookTitle: doc?.bookId?.title || existing?.bookTitle || 'Unknown Title',
        author: doc?.bookId?.author || existing?.author || 'Unknown Author',
        accessionNumber: doc?.accessionNumber || existing?.accessionNumber,
        status: doc?.status || 'Missing',
        isResolved: false,
      };
    });

    audit.summary.missingCount = audit.missingCopies.length;
    audit.summary.accuracyRate =
      audit.summary.totalExpected > 0
        ? Math.round((audit.summary.verifiedCount / audit.summary.totalExpected) * 100)
        : 100;

    audit.status = 'COMPLETED';
    audit.completedAt = new Date();
    await audit.save();

    res.json({
      success: true,
      message: `Audit session "${audit.auditNumber}" finalized successfully. Identified ${audit.summary.missingCount} missing copy(ies).`,
      audit,
      data: audit,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/audits
 * List audit history
 */
exports.getAudits = async (req, res, next) => {
  try {
    const audits = await InventoryAudit.find()
      .populate('locationId', 'locationCode building floor section shelf')
      .populate('startedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      total: audits.length,
      audits,
      data: audits,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/audits/:auditId
 * Get detailed audit session by ID
 */
exports.getAuditById = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const audit = await InventoryAudit.findById(auditId)
      .populate('locationId')
      .populate('startedBy', 'name email staffId');

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit session not found.' });
    }

    // Fetch scan log entries for this session
    const scans = await InventoryAuditScan.find({ auditId: audit._id })
      .populate('scannedBy', 'name email')
      .populate('recordedLocationId', 'locationCode')
      .populate('homeLocationId', 'locationCode')
      .sort({ scanTimestamp: -1 })
      .lean();

    res.json({
      success: true,
      audit,
      scans,
      data: {
        ...audit.toObject(),
        scans,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/smartshelf/audits/:auditId/resolve
 * Resolve exception (misplaced, missing, unknown, pending verification)
 */
exports.resolveAuditException = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const { copyIdentifier, itemType, action, notes } = req.body;

    const audit = await InventoryAudit.findById(auditId);
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit session not found.' });
    }

    const cleanCopyId = (copyIdentifier || '').trim();
    const validActions = ['RELOCATE_TO_SHELF', 'RETURN_TO_HOME', 'CONFIRM_MISSING', 'DISMISS'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Supported actions: ${validActions.join(', ')}`,
      });
    }

    let copy = null;
    if (cleanCopyId) {
      copy = await BookCopy.findOne({ copyId: cleanCopyId, isDeleted: false });
    }

    // Execute requested resolution
    if (action === 'RELOCATE_TO_SHELF') {
      if (!copy) {
        return res.status(404).json({ success: false, message: `Copy "${cleanCopyId}" not found for relocation.` });
      }
      const prevLocId = copy.locationId;
      copy.locationId = audit.locationId;
      copy.isMisplaced = false;
      copy.misplacedDetectedLocationId = null;
      await copy.save();

      // Log movement history
      await BookMovement.create({
        copyId: copy._id,
        copyIdentifier: copy.copyId,
        previousLocationId: prevLocId,
        newLocationId: audit.locationId,
        movedBy: req.user?._id,
        movementTimestamp: new Date(),
        reason: (notes || 'Relocated during shelf audit exception resolution').trim(),
        auditStatus: 'AUDIT_CONFIRMED',
      });

      // Update misplaced list item
      const item = audit.misplacedCopies.find((m) => m.copyIdentifier === cleanCopyId);
      if (item) {
        item.isResolved = true;
        item.resolutionAction = 'RELOCATE_TO_SHELF';
        item.resolvedAt = new Date();
        item.resolvedBy = req.user?._id;
      }
    } else if (action === 'RETURN_TO_HOME') {
      if (copy) {
        copy.isMisplaced = false;
        copy.misplacedDetectedLocationId = null;
        await copy.save();
      }
      const item = audit.misplacedCopies.find((m) => m.copyIdentifier === cleanCopyId);
      if (item) {
        item.isResolved = true;
        item.resolutionAction = 'RETURN_TO_HOME';
        item.resolvedAt = new Date();
        item.resolvedBy = req.user?._id;
      }
    } else if (action === 'CONFIRM_MISSING') {
      if (copy) {
        copy.status = 'Lost';
        await copy.save();
      }
      const item = audit.missingCopies.find((m) => m.copyIdentifier === cleanCopyId);
      if (item) {
        item.isResolved = true;
        item.resolutionAction = 'CONFIRM_MISSING';
        item.resolvedAt = new Date();
        item.resolvedBy = req.user?._id;
      }
    } else if (action === 'DISMISS') {
      // Find in misplaced, missing, unknown, or pending
      const misItem = audit.misplacedCopies.find((m) => m.copyIdentifier === cleanCopyId);
      if (misItem) {
        misItem.isResolved = true;
        misItem.resolutionAction = 'DISMISS';
      }
      const missItem = audit.missingCopies.find((m) => m.copyIdentifier === cleanCopyId);
      if (missItem) {
        missItem.isResolved = true;
        missItem.resolutionAction = 'DISMISS';
      }
      const unkItem = audit.unknownScans.find((u) => u.rawText === cleanCopyId);
      if (unkItem) {
        unkItem.isResolved = true;
        unkItem.resolutionAction = 'DISMISS';
      }
      const pendItem = audit.pendingVerificationCopies.find((p) => p.copyIdentifier === cleanCopyId);
      if (pendItem) {
        pendItem.isResolved = true;
        pendItem.resolutionAction = 'DISMISS';
      }
    }

    // Append resolution record
    audit.resolutions.push({
      itemType: itemType || 'EXCEPTION',
      copyIdentifier: cleanCopyId,
      action,
      performedBy: req.user?._id,
      performedAt: new Date(),
      notes: (notes || '').trim(),
    });

    await audit.save();

    res.json({
      success: true,
      message: `Exception for "${cleanCopyId || itemType}" resolved with action "${action}".`,
      audit,
      data: audit,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/smartshelf/audits/:auditId/export
 * Export audit report as CSV or JSON
 */
exports.exportAuditReport = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const { format = 'csv' } = req.query;

    const audit = await InventoryAudit.findById(auditId)
      .populate('locationId')
      .populate('startedBy', 'name email');

    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit session not found.' });
    }

    if (format === 'json') {
      return res.json({ success: true, audit });
    }

    // CSV format
    const rows = [];
    rows.push(['CRESCENT INSTITUTE CENTRAL LIBRARY - SMARTSHELF AI AUDIT REPORT']);
    rows.push(['Audit Number', audit.auditNumber]);
    rows.push(['Audited Location', audit.locationCode || '']);
    rows.push(['Status', audit.status]);
    rows.push(['Started At', audit.startedAt ? new Date(audit.startedAt).toISOString() : '']);
    rows.push(['Completed At', audit.completedAt ? new Date(audit.completedAt).toISOString() : 'IN PROGRESS']);
    rows.push(['Auditor', audit.startedBy?.name || 'Librarian']);
    rows.push(['']);
    rows.push(['SUMMARY METRICS']);
    rows.push(['Total Expected', audit.summary.totalExpected]);
    rows.push(['Total Scans', audit.summary.totalScanned]);
    rows.push(['Unique Copies Scanned', audit.summary.uniqueScanned]);
    rows.push(['Verified Copies', audit.summary.verifiedCount]);
    rows.push(['Misplaced Copies', audit.summary.misplacedCount]);
    rows.push(['Missing Copies', audit.summary.missingCount]);
    rows.push(['Unknown QR Scans', audit.summary.unknownCount]);
    rows.push(['Duplicate Scans', audit.summary.duplicateCount]);
    rows.push(['Pending Verification', audit.summary.pendingVerificationCount]);
    rows.push(['Accuracy Rate', `${audit.summary.accuracyRate}%`]);
    rows.push(['']);
    rows.push(['CATEGORY', 'COPY ID', 'ACCESSION NO', 'TITLE', 'AUTHOR', 'RECORDED SHELF', 'ACTUAL SHELF', 'STATUS', 'RESOLVED']);

    // Verified
    (audit.verifiedCopies || []).forEach((v) => {
      rows.push(['VERIFIED', v.copyIdentifier, '', v.bookTitle || '', v.author || '', audit.locationCode, audit.locationCode, 'OK', 'YES']);
    });

    // Misplaced
    (audit.misplacedCopies || []).forEach((m) => {
      rows.push(['MISPLACED', m.copyIdentifier, '', m.bookTitle || '', m.author || '', m.recordedLocationCode || '', m.foundLocationCode || '', 'Misplaced', m.isResolved ? 'YES' : 'NO']);
    });

    // Missing
    (audit.missingCopies || []).forEach((m) => {
      rows.push(['MISSING', m.copyIdentifier, m.accessionNumber || '', m.bookTitle || '', m.author || '', audit.locationCode, 'NOT FOUND', 'Missing', m.isResolved ? 'YES' : 'NO']);
    });

    // Unknown
    (audit.unknownScans || []).forEach((u) => {
      rows.push(['UNKNOWN_QR', u.rawText, '', 'Unregistered / Invalid QR', '', 'UNKNOWN', audit.locationCode, 'Unknown', u.isResolved ? 'YES' : 'NO']);
    });

    const csvContent = rows
      .map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${audit.auditNumber}-report.csv"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
};

