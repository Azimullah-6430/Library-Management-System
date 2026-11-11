'use strict';
const crypto = require('crypto');
const QRCode = require('qrcode');

/**
 * Generate a cryptographically random, collision-resistant opaque QR identifier
 * Format: CLMS-QID-<24 uppercase hex characters> (96 bits of cryptographic entropy)
 */
const generateOpaqueQrIdentifier = () => {
  const token = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `CLMS-QID-${token}`;
};

/**
 * Format a secure application resolver URL or opaque payload
 */
const formatCopyPayload = (qrIdentifier, baseUrl = '') => {
  const clean = String(qrIdentifier || '').trim().toUpperCase();
  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    return `${cleanBase}/#/scan/${clean}`;
  }
  return clean;
};

const formatLocationPayload = (locationCode) => {
  const clean = String(locationCode || '').trim().toUpperCase();
  return clean.startsWith('CLMS:LOC:') ? clean : `CLMS:LOC:${clean}`;
};

/**
 * Generate base64 Data URL for QR Code
 */
const generateQrDataUrl = async (payload, options = {}) => {
  try {
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'H', // High error correction for printed spine durability
      margin: 2,
      width: options.width || 400,
      color: {
        dark: '#0a1a30',
        light: '#ffffff',
      },
      ...options,
    });
  } catch (err) {
    console.error('Failed to generate QR data URL:', err);
    return '';
  }
};

/**
 * Generate PNG binary Buffer for QR Code (used in PDF labels & image downloads)
 */
const generateQrPngBuffer = async (payload, options = {}) => {
  try {
    return await QRCode.toBuffer(payload, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: options.width || 400,
      color: {
        dark: '#0a1a30',
        light: '#ffffff',
      },
      ...options,
    });
  } catch (err) {
    console.error('Failed to generate QR PNG buffer:', err);
    return null;
  }
};

/**
 * Generate SVG string for QR Code
 */
const generateQrSvg = async (payload, options = {}) => {
  try {
    return await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: options.width || 250,
      color: {
        dark: '#0a1a30',
        light: '#ffffff',
      },
      ...options,
    });
  } catch (err) {
    console.error('Failed to generate QR SVG:', err);
    return '';
  }
};

/**
 * Parse and validate QR payload (handles URLs, opaque tokens, legacy prefixes)
 */
const parseQrPayload = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // 1. If scanned payload is a URL (e.g. "http://localhost:5000/#/scan/CLMS-QID-1234567890ABCDEF")
  const urlMatch = trimmed.match(/\/scan\/([A-Za-z0-9_-]+)/i) || trimmed.match(/[?&]qid=([A-Za-z0-9_-]+)/i);
  if (urlMatch) {
    const extracted = urlMatch[1].toUpperCase();
    return {
      type: 'OPAQUE_QID',
      identifier: extracted,
      raw: trimmed,
    };
  }

  // 2. Direct Opaque QR Identifier (e.g. "CLMS-QID-9E2F4A1B8C0D")
  if (/^CLMS-QID-[A-F0-9]{16,32}$/i.test(trimmed)) {
    return {
      type: 'OPAQUE_QID',
      identifier: trimmed.toUpperCase(),
      raw: trimmed,
    };
  }

  // 3. Legacy copy format (e.g. "CLMS:COPY:ACC-0101-C01")
  if (trimmed.startsWith('CLMS:COPY:')) {
    return {
      type: 'COPY',
      identifier: trimmed.slice('CLMS:COPY:'.length).trim().toUpperCase(),
      raw: trimmed,
    };
  }

  // 4. Shelf location format (e.g. "CLMS:LOC:LIB-G-CS-A1-R1-RW1")
  if (trimmed.startsWith('CLMS:LOC:')) {
    return {
      type: 'LOCATION',
      identifier: trimmed.slice('CLMS:LOC:'.length).trim().toUpperCase(),
      raw: trimmed,
    };
  }

  // 5. Fallback for accession or copy ID (e.g. "ACC-0101-C01" or "ACC-0101")
  if (/^ACC-\d+(-C\d+)?$/i.test(trimmed)) {
    return {
      type: 'COPY',
      identifier: trimmed.toUpperCase(),
      raw: trimmed.toUpperCase(),
    };
  }

  // 6. Fallback for raw location code (e.g. "LIB-G-CS-A1-R1-RW1")
  if (/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/i.test(trimmed)) {
    return {
      type: 'LOCATION',
      identifier: trimmed.toUpperCase(),
      raw: trimmed.toUpperCase(),
    };
  }

  return {
    type: 'UNKNOWN',
    identifier: trimmed,
    raw: trimmed,
  };
};

module.exports = {
  generateOpaqueQrIdentifier,
  formatCopyPayload,
  formatLocationPayload,
  generateQrDataUrl,
  generateQrPngBuffer,
  generateQrSvg,
  parseQrPayload,
};
