'use strict';
const PDFDocument = require('pdfkit');
const { generateQrPngBuffer, formatCopyPayload } = require('./qrCodeHelper');

/**
 * Predefined standard label layouts
 */
const LAYOUTS = {
  // A4 standard 3 columns x 8 rows = 24 labels per page (65mm x 33mm each)
  'sheet_3x8': {
    name: 'Standard A4 Label Sheet (3x8 - 24 per page)',
    pageSize: 'A4',
    orientation: 'portrait',
    pageWidth: 595.28,
    pageHeight: 841.89,
    cols: 3,
    rows: 8,
    marginLeft: 25,
    marginTop: 28,
    labelWidth: 172,
    labelHeight: 92,
    gutterX: 14,
    gutterY: 6,
    qrSize: 66,
  },
  // A4 large pocket 2 columns x 5 rows = 10 labels per page (95mm x 50mm each)
  'sheet_2x5': {
    name: 'Book Pocket / Inside Cover Sheet (2x5 - 10 per page)',
    pageSize: 'A4',
    orientation: 'portrait',
    pageWidth: 595.28,
    pageHeight: 841.89,
    cols: 2,
    rows: 5,
    marginLeft: 30,
    marginTop: 35,
    labelWidth: 250,
    labelHeight: 140,
    gutterX: 35,
    gutterY: 14,
    qrSize: 100,
  },
  // Single thermal spine label roll (50mm x 30mm = 141.7pt x 85pt)
  'thermal_spine': {
    name: 'Thermal Spine Label (50mm x 30mm continuous roll)',
    pageSize: [142, 85],
    orientation: 'landscape',
    pageWidth: 142,
    pageHeight: 85,
    cols: 1,
    rows: 1,
    marginLeft: 5,
    marginTop: 5,
    labelWidth: 132,
    labelHeight: 75,
    gutterX: 0,
    gutterY: 0,
    qrSize: 58,
  },
};

/**
 * Generate multi-label printable PDF document
 * @param {Array} copies - Array of populated BookCopy objects with bookId & locationId
 * @param {Object} options - { layout: 'sheet_3x8' | 'sheet_2x5' | 'thermal_spine', baseUrl: '' }
 * @returns {Promise<Buffer>} PDF Buffer
 */
const generateLabelsPdf = async (copies = [], options = {}) => {
  const layoutKey = options.layout && LAYOUTS[options.layout] ? options.layout : 'sheet_3x8';
  const cfg = LAYOUTS[layoutKey];
  const baseUrl = options.baseUrl || '';

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: cfg.pageSize,
        layout: cfg.orientation,
        margin: 0,
        autoFirstPage: true,
        info: {
          Title: 'Crescent Library — SmartShelf AI QR Labels',
          Author: 'B.S. Abdur Rahman Crescent Institute of Science and Technology',
          Subject: 'Physical Book Copy Spine & Inside-Cover QR Labels',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const labelsPerPage = cfg.cols * cfg.rows;
      let labelIdx = 0;

      for (let i = 0; i < copies.length; i++) {
        const copy = copies[i];
        const pageLabelIndex = labelIdx % labelsPerPage;

        if (labelIdx > 0 && pageLabelIndex === 0) {
          doc.addPage({ size: cfg.pageSize, layout: cfg.orientation, margin: 0 });
        }

        const col = pageLabelIndex % cfg.cols;
        const row = Math.floor(pageLabelIndex / cfg.cols);

        const x = cfg.marginLeft + col * (cfg.labelWidth + cfg.gutterX);
        const y = cfg.marginTop + row * (cfg.labelHeight + cfg.gutterY);

        // Render individual label
        await renderSingleLabel(doc, copy, x, y, cfg, baseUrl);
        labelIdx++;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Render one individual label at (x, y) coordinates
 */
const renderSingleLabel = async (doc, copy, x, y, cfg, baseUrl) => {
  const book = copy.bookId || {};
  const location = copy.locationId || {};
  const qrIdentifier = copy.qrIdentifier || copy.copyId;
  const qrPayload = formatCopyPayload(qrIdentifier, baseUrl);

  // High-resolution QR PNG buffer
  const qrBuffer = await generateQrPngBuffer(qrPayload, { width: 300 });

  // Draw light boundary border
  doc.roundedRect(x, y, cfg.labelWidth, cfg.labelHeight, 3)
     .lineWidth(0.5)
     .strokeColor('#d0d7de')
     .stroke();

  // Draw decorative Crescent Navy header pill
  const headerHeight = cfg.labelHeight > 100 ? 18 : 13;
  doc.rect(x + 1, y + 1, cfg.labelWidth - 2, headerHeight)
     .fillColor('#0a1a30')
     .fill();

  doc.font('Helvetica-Bold')
     .fontSize(cfg.labelHeight > 100 ? 9 : 7)
     .fillColor('#d4af37') // Crescent Gold
     .text('CRESCENT CENTRAL LIBRARY', x + 4, y + 3, {
       width: cfg.labelWidth - 8,
       align: 'center',
     });

  const contentY = y + headerHeight + 4;
  const qrSize = Math.min(cfg.qrSize, cfg.labelHeight - headerHeight - 8);

  // Embed QR Image on Left
  if (qrBuffer) {
    doc.image(qrBuffer, x + 4, contentY, {
      width: qrSize,
      height: qrSize,
    });
  }

  // Text Column on Right
  const textX = x + qrSize + 8;
  const textW = cfg.labelWidth - qrSize - 12;

  // Book Title
  const title = (book.title || 'Untitled Book').slice(0, 48);
  doc.font('Helvetica-Bold')
     .fontSize(cfg.labelHeight > 100 ? 9.5 : 7.5)
     .fillColor('#0f172a')
     .text(title, textX, contentY, {
       width: textW,
       height: cfg.labelHeight > 100 ? 28 : 18,
       ellipsis: true,
     });

  // Accession & Copy ID
  const acc = copy.accessionNumber || copy.copyId || book.acc || '—';
  doc.font('Helvetica')
     .fontSize(cfg.labelHeight > 100 ? 8 : 6.5)
     .fillColor('#334155')
     .text(`ACC: ${acc}`, textX, contentY + (cfg.labelHeight > 100 ? 32 : 20), {
       width: textW,
     });

  doc.font('Helvetica-Bold')
     .fontSize(cfg.labelHeight > 100 ? 8.5 : 7)
     .fillColor('#0a1a30')
     .text(`COPY: ${copy.copyId || `Copy #${copy.copyNumber || 1}`}`, textX, contentY + (cfg.labelHeight > 100 ? 44 : 29), {
       width: textW,
     });

  // Physical Shelf Location
  const shelfCode = location.locationCode || location.shelf || book.shelf || 'UNASSIGNED';
  doc.font('Helvetica')
     .fontSize(cfg.labelHeight > 100 ? 8 : 6)
     .fillColor('#64748b')
     .text(`SHELF: ${shelfCode}`, textX, contentY + (cfg.labelHeight > 100 ? 56 : 38), {
       width: textW,
       ellipsis: true,
     });

  // Condition & Status tag
  if (cfg.labelHeight > 100) {
    doc.font('Helvetica')
       .fontSize(7)
       .fillColor('#059669')
       .text(`STATUS: ${copy.status || 'Available'} · ${copy.condition || 'Good'}`, textX, contentY + 70, {
         width: textW,
       });
  }
};

module.exports = {
  LAYOUTS,
  generateLabelsPdf,
};

