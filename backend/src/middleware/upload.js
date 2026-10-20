'use strict';
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ── Disk Storage for Book Covers ─────────────────────────────────────────────
const coverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `cover-${file.fieldname}-${unique}${ext}`);
  },
});

const imageFileFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG and WebP images are permitted for covers.'), false);
  }
};

const maxMb = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 5;

const uploadCovers = multer({
  storage: coverStorage,
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: imageFileFilter,
}).fields([
  { name: 'frontCover', maxCount: 1 },
  { name: 'backCover',  maxCount: 1 },
  { name: 'front',      maxCount: 1 },
  { name: 'back',       maxCount: 1 },
]);

// ── Memory Storage for CSV file processing ──────────────────────────────────
const csvStorage = multer.memoryStorage();
const csvFileFilter = (_req, file, cb) => {
  if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed for catalog import.'), false);
  }
};

const uploadCsv = multer({
  storage: csvStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: csvFileFilter,
}).single('file');

// Helper to safely delete file from uploads
const deleteFile = (relativeOrAbsolute) => {
  if (!relativeOrAbsolute) return;
  const filename = path.basename(relativeOrAbsolute);
  const target = path.join(uploadDir, filename);
  if (fs.existsSync(target)) {
    fs.unlink(target, (err) => {
      if (err) console.error('Failed to delete file:', target, err);
    });
  }
};

module.exports = {
  uploadCovers,
  uploadCsv,
  deleteFile,
  uploadDir,
};
