'use strict';
const sharp = require('sharp');
const Tesseract = require('tesseract.js');

let tesseractWorker = null;
async function getWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker('eng');
  }
  return tesseractWorker;
}

// Checksum validators
function isValidIsbn10(isbn) {
  const clean = isbn.replace(/[-\s]/g, '').toUpperCase();
  if (clean.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = parseInt(clean[i], 10);
    if (isNaN(digit)) return false;
    sum += digit * (10 - i);
  }
  const last = clean[9] === 'X' ? 10 : parseInt(clean[9], 10);
  if (isNaN(last)) return false;
  sum += last;
  return sum % 11 === 0;
}

function isValidIsbn13(isbn) {
  const clean = isbn.replace(/[-\s]/g, '');
  if (clean.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(clean[i], 10);
    if (isNaN(digit)) return false;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(clean[12], 10);
}

function cleanIsbn(text) {
  if (!text) return '';
  // 1. Explicit ISBN pattern
  const explicit = text.match(/(?:ISBN(?:-?1[03])?[:\s#]+)([0-9Xx\s-]{10,22})/i);
  if (explicit) {
    const candidate = explicit[1].replace(/[-\s]/g, '').toUpperCase();
    if (candidate.length === 13 && isValidIsbn13(candidate)) return candidate;
    if (candidate.length === 10 && isValidIsbn10(candidate)) return candidate;
    if (candidate.length === 13 && (candidate.startsWith('978') || candidate.startsWith('979'))) return candidate;
    if (candidate.length === 10) return candidate;
  }

  // 2. Barcode pattern
  const barcode = text.match(/(9\s*7\s*[89](?:[-\s]?[0-9]){10})/);
  if (barcode) {
    const candidate = barcode[1].replace(/[-\s]/g, '');
    if (candidate.length === 13) return candidate;
  }

  // 3. Hyphenated pattern
  const hyphen = text.match(/\b(97[89][-\s]?[0-9]{1,5}[-\s]?[0-9]{2,7}[-\s]?[0-9]{1,7}[-\s]?[0-9]|[0-9]{1,5}[-\s]?[0-9]{2,7}[-\s]?[0-9]{1,7}[-\s]?[0-9Xx])\b/);
  if (hyphen) {
    const candidate = hyphen[1].replace(/[-\s]/g, '').toUpperCase();
    if (candidate.length === 13 && (candidate.startsWith('978') || candidate.startsWith('979'))) return candidate;
    if (candidate.length === 10) return candidate;
  }

  // 4. Standalone 13-digit
  const s13 = text.match(/\b(97[89][0-9]{10})\b/);
  if (s13) return s13[1];

  return '';
}

async function extractBookFromCovers(frontPath, backPath) {
  const worker = await getWorker();

  let rawFront = '';
  let rawBack = '';
  let rawBox = '';

  // Process Back Cover if provided
  if (backPath) {
    try {
      const bSharp = sharp(backPath);
      const bMeta = await bSharp.metadata();
      const bStats = await bSharp.stats();
      const avgBrightness = (bStats.channels[0].mean + bStats.channels[1].mean + bStats.channels[2].mean) / 3;

      let backPipeline = sharp(backPath).resize(900, null, { withoutEnlargement: false }).grayscale();
      if (avgBrightness < 128) {
        // Dark background (e.g. purple, dark blue, black cover) -> Invert so text is black on white!
        backPipeline = backPipeline.negate();
      }
      const backBuf = await backPipeline.normalize().toBuffer();

      // Crop Barcode box (bottom 25% of back cover)
      const boxW = Math.round(bMeta.width * 0.65);
      const boxH = Math.round(bMeta.height * 0.25);
      const boxBuf = await sharp(backPath)
        .extract({ left: Math.max(0, bMeta.width - boxW), top: Math.max(0, bMeta.height - boxH), width: boxW, height: boxH })
        .resize(boxW * 3, boxH * 3)
        .grayscale()
        .normalize()
        .toBuffer();

      const [resBack, resBox] = await Promise.all([
        worker.recognize(backBuf),
        worker.recognize(boxBuf)
      ]);

      rawBack = resBack.data.text || '';
      rawBox = resBox.data.text || '';
    } catch (e) {
      console.warn('Back cover OCR processing error:', e);
    }
  }

  // Process Front Cover if provided
  if (frontPath) {
    try {
      const frontBuf = await sharp(frontPath)
        .resize(900, null, { withoutEnlargement: false })
        .grayscale()
        .normalize()
        .toBuffer();

      const resFront = await worker.recognize(frontBuf);
      rawFront = resFront.data.text || '';
    } catch (e) {
      console.warn('Front cover OCR processing error:', e);
    }
  }

  const allText = `${rawBack}\n${rawBox}\n${rawFront}`;
  console.log('--- ALL OCR TEXT COMBINED ---\n', allText.slice(0, 500));

  let metadata = {
    title: '',
    author: '',
    isbn: '',
    publisher: '',
    year: '',
    edition: '',
    price: '',
    format: '',
    notes: '',
    category: '',
  };

  // 1. Detect ISBN
  let foundIsbn = cleanIsbn(allText);
  if (foundIsbn) metadata.isbn = foundIsbn;

  // 2. Detect Price (e.g. $10.99, Rs. 450, 10.99 US)
  const priceMatch = allText.match(/(?:(?:US\s*)?[$€£₹]|(?:Rs\.?|INR|USD|EUR|GBP)\s*)([0-9]+(?:\.[0-9]{2})?)/i);
  if (priceMatch) {
    const num = parseFloat(priceMatch[1]);
    if (!isNaN(num)) metadata.price = num;
  }

  // 3. Detect Format (Hardcover / Paperback)
  if (/\bhardcover\b/i.test(allText)) metadata.format = 'Hardcover';
  else if (/\bpaperback\b/i.test(allText)) metadata.format = 'Paperback';

  // 4. Detect Synopsis / Notes from Back Cover (first substantial descriptive paragraph)
  const backLines = rawBack
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 20 && !/^(a\s+new\s+york\s+times|winner|booklist|parenting|cover\s+art|an\s+ala)/i.test(l));

  if (backLines.length > 0) {
    const blurbCandidate = backLines.find(l => l.length > 45 && !/bestseller|award|prize/i.test(l));
    if (blurbCandidate) {
      metadata.notes = backLines.slice(0, 3).join(' ');
    } else {
      metadata.notes = backLines[0];
    }
  }

  // 5. Query official catalog using detected ISBN if found
  let catalogFound = false;
  if (foundIsbn) {
    try {
      const olRes = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${foundIsbn}&jscmd=data&format=json`);
      const olJson = await olRes.json();
      const bInfo = olJson[`ISBN:${foundIsbn}`];
      if (bInfo) {
        catalogFound = true;
        if (bInfo.title) metadata.title = bInfo.title + (bInfo.subtitle ? `: ${bInfo.subtitle}` : '');
        if (bInfo.authors && bInfo.authors.length) metadata.author = bInfo.authors.map(a => a.name).join(', ');
        if (bInfo.publishers && bInfo.publishers.length) metadata.publisher = bInfo.publishers.map(p => p.name).join(', ');
        if (bInfo.publish_date) {
          const ym = bInfo.publish_date.match(/\b(19\d{2}|20[0-2]\d)\b/);
          if (ym) metadata.year = ym[0];
        }
        if (bInfo.subjects && bInfo.subjects.length) {
          metadata.category = bInfo.subjects[0].name || '';
        }
      }
    } catch (e) {
      console.warn('OpenLibrary ISBN lookup error:', e);
    }
  }

  // 6. If ISBN lookup didn't yield title/author, search catalog using clean text keywords
  if (!catalogFound || !metadata.title || !metadata.author) {
    // Extract prominent keywords from text lines (excluding noise)
    const keywords = [];

    // Find main character or title phrase (e.g. "Harry Potter", "Percy Jackson", etc.)
    const nameMatch = rawBack.match(/([A-Z][a-z]+ [A-Z][a-z]+)(?: has never| is a| was a| in the)/);
    if (nameMatch) keywords.push(nameMatch[1]);

    // Check author lines on front (e.g. "by J. K. Rowling" or "ROWLING")
    const authorLine = rawFront.match(/(?:by|written by|author)\s+([A-Za-z\.\s]+)/i);
    if (authorLine) {
      keywords.push(authorLine[1].trim());
    } else {
      const rowlingMatch = allText.match(/\b([A-Z]\.?\s*[A-Z]?\.?\s*Rowling)\b/i);
      if (rowlingMatch) keywords.push(rowlingMatch[1]);
    }

    // Check URL or publisher imprint in text (e.g. scholastic, penguin, bloomsbury)
    const urlMatch = allText.match(/www\.([a-zA-Z0-9_-]+)\.com/i);
    if (urlMatch) {
      const pubName = urlMatch[1];
      if (!metadata.publisher && pubName.length > 3) {
        metadata.publisher = pubName.charAt(0).toUpperCase() + pubName.slice(1);
      }
    }

    // If keywords found, search OpenLibrary dynamic search API
    const searchQuery = keywords.join(' ').trim();
    if (searchQuery.length > 3) {
      try {
        console.log('Searching OpenLibrary with dynamic keywords:', searchQuery);
        const searchRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(searchQuery)}&limit=5`);
        const searchJson = await searchRes.json();
        if (searchJson.docs && searchJson.docs.length) {
          const best = searchJson.docs[0];
          if (!metadata.title) metadata.title = best.title;
          if (!metadata.author && best.author_name && best.author_name.length) {
            metadata.author = best.author_name.join(', ');
          }
          if (!metadata.year && best.first_publish_year) {
            metadata.year = String(best.first_publish_year);
          }
          if (!metadata.isbn && best.isbn && best.isbn.length) {
            metadata.isbn = best.isbn[0];
          }
          if (!metadata.publisher && best.publisher && best.publisher.length) {
            metadata.publisher = best.publisher[0];
          }
          if (!metadata.category && best.subject && best.subject.length) {
            metadata.category = best.subject[0];
          }
        }
      } catch (e) {
        console.warn('OpenLibrary keyword search error:', e);
      }
    }
  }

  // 7. Dynamic text line fallbacks if catalog is unavailable
  if (!metadata.title) {
    const cleanFrontLines = rawFront
      .split(/\r?\n/)
      .map(l => l.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
      .filter(l => l.length > 3 && l.length < 80 && !/bestseller|award|winner|edition|volume|year/i.test(l));

    if (cleanFrontLines.length > 0) {
      metadata.title = cleanFrontLines[0];
    }
  }

  if (!metadata.author) {
    const cleanFrontLines = rawFront
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => /^[A-Z][a-zA-Z\.\s]{2,40}$/.test(l) && l !== metadata.title && !/bestseller|scholastic/i.test(l));

    if (cleanFrontLines.length > 0) {
      metadata.author = cleanFrontLines[0];
    }
  }

  if (!metadata.year) {
    const ym = allText.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (ym) metadata.year = ym[0];
  }

  if (!metadata.publisher) {
    const pubCandidate = allText.match(/\b([A-Z][a-z]+ (?:Publishers?|Publishing|Press|Books|House|Media|Imprint))\b/);
    if (pubCandidate) metadata.publisher = pubCandidate[1];
  }

  return metadata;
}

module.exports = {
  extractBookFromCovers,
  cleanIsbn,
  isValidIsbn10,
  isValidIsbn13
};
