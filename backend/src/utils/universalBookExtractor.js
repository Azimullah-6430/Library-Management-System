'use strict';
const fs = require('fs');
const sharp = require('sharp');

function toTitleCase(str) {
  if (!str) return '';
  const minors = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v[.]?|via)$/i;
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word, idx) => {
      if (idx > 0 && minors.test(word)) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function similarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const getBigrams = str => {
    const s = str.toLowerCase();
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let hits = 0;
  for (const b of b1) if (b2.has(b)) hits++;
  return (2.0 * hits) / (b1.size + b2.size || 1);
}

function validateIsbn10(isbn) {
  const clean = String(isbn).replace(/[-\s]/g, '').toUpperCase();
  if (!/^\d{9}[\dX]$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i], 10) * (10 - i);
  const last = clean[9] === 'X' ? 10 : parseInt(clean[9], 10);
  sum += last;
  return sum % 11 === 0;
}

function isbn10to13(isbn10) {
  const clean = String(isbn10).replace(/[-\s]/g, '').toUpperCase();
  const base = '978' + clean.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

function validateIsbn13(isbn) {
  const clean = String(isbn).replace(/[-\s]/g, '');
  if (!/^\d{13}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(clean[i], 10) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(clean[12], 10);
}

/**
 * Universal Currency to INR Converter
 * Converts USD, GBP, EUR, CAD, AUD or other foreign currencies to Indian Rupees (INR)
 */
function convertToINR(text) {
  if (!text) return null;
  const rates = {
    USD: 84.0, // Standard USD to INR
    EUR: 92.0, // EUR to INR
    GBP: 108.0, // GBP to INR
    CAD: 62.0, // CAD to INR
    AUD: 55.0, // AUD to INR
    INR: 1.0,
  };

  // 1. Explicit INR / Rupee patterns (e.g. ₹450, Rs. 450, Rs 450, 450 INR)
  const inrM = text.match(/(?:₹|Rs\.?|INR)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:₹|Rs\.?|INR)/i);
  if (inrM) {
    const v = parseFloat(inrM[1]);
    if (!isNaN(v)) return { inr: Math.round(v), original: `₹${v}`, currency: 'INR' };
  }

  // 2. GBP (£ / GBP)
  const gbpM = text.match(/(?:£|GBP)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:£|GBP)/i);
  if (gbpM) {
    const v = parseFloat(gbpM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.GBP), original: `£${v} GBP`, currency: 'GBP' };
  }

  // 3. EUR (€ / EUR)
  const eurM = text.match(/(?:€|EUR)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:€|EUR)/i);
  if (eurM) {
    const v = parseFloat(eurM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.EUR), original: `€${v} EUR`, currency: 'EUR' };
  }

  // 4. CAD (CAN$ / C$ / CAD)
  const cadM = text.match(/(?:CAN\s*\$|C\s*\$|CAD)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*CAD/i);
  if (cadM) {
    const v = parseFloat(cadM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.CAD), original: `C$${v} CAD`, currency: 'CAD' };
  }

  // 5. AUD (A$ / AUD)
  const audM = text.match(/(?:A\s*\$|AUD)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*AUD/i);
  if (audM) {
    const v = parseFloat(audM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.AUD), original: `A$${v} AUD`, currency: 'AUD' };
  }

  // 6. USD ($10.99, $10.99 US, US $10.99, 10.99 USD)
  const usdM = text.match(/(?:US\s*)?\$([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/USD\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
               text.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:USD|US\b)/i);
  if (usdM) {
    const v = parseFloat(usdM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.USD), original: `$${v} USD`, currency: 'USD' };
  }

  // 7. Generic currency symbol fallback
  const genM = text.match(/[$€£₹]([0-9]+(?:\.[0-9]{2})?)/);
  if (genM) {
    const v = parseFloat(genM[1]);
    if (!isNaN(v)) return { inr: Math.round(v * rates.USD), original: `$${v}`, currency: 'USD' };
  }

  return null;
}

async function runOcrSpace(buffer) {
  try {
    const fd = new FormData();
    fd.append('base64Image', 'data:image/jpeg;base64,' + buffer.toString('base64'));
    fd.append('apikey', 'K81395892588957');
    fd.append('language', 'eng');
    fd.append('OCREngine', '2');
    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(9000),
    });
    const j = await res.json();
    return j.ParsedResults?.[0]?.ParsedText || '';
  } catch (err) {
    console.warn('OCR space warning:', err.message);
    return '';
  }
}

async function extractDynamicBook(frontPath, backPath) {
  let frontText = '';
  let backText = '';
  let barcodeText = '';

  // 1. Read Front Cover
  if (frontPath && fs.existsSync(frontPath)) {
    const fBuf = fs.readFileSync(frontPath);
    frontText = await runOcrSpace(fBuf);
  }

  // 2. Read Back Cover
  if (backPath && fs.existsSync(backPath)) {
    const bBuf = fs.readFileSync(backPath);
    backText = await runOcrSpace(bBuf);

    // Crop bottom 26% for barcode & ISBN zone
    try {
      await new Promise(r => setTimeout(r, 600));
      const meta = await sharp(backPath).metadata();
      const bHeight = Math.floor(meta.height * 0.26);
      const bTop = meta.height - bHeight;
      const croppedBuf = await sharp(backPath)
        .extract({ left: 0, top: bTop, width: meta.width, height: bHeight })
        .resize(meta.width * 2)
        .toBuffer();
      barcodeText = await runOcrSpace(croppedBuf);
    } catch (e) {
      console.warn('Barcode crop failed:', e.message);
    }
  }

  const combinedText = `${frontText}\n${backText}\n${barcodeText}`.trim();

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

  // 3. Extract Price & Convert Foreign Currency (USD, GBP, EUR, CAD, AUD) to INR
  const convertedPrice = convertToINR(combinedText);
  if (convertedPrice) {
    metadata.price = convertedPrice.inr;
    metadata.originalPrice = convertedPrice.original;
    metadata.currency = 'INR';
  }

  // 4. Extract Format
  if (/\bhardcover\b/i.test(combinedText)) metadata.format = 'Hardcover';
  else if (/\bpaperback\b/i.test(combinedText)) metadata.format = 'Paperback';

  // 5. Extract Synopsis / Description from back cover
  const backLines = backText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 20 && !/^(a\s+new\s+york\s+times|winner|booklist|parenting|cover\s+art|an\s+ala|mscholastic|www\.)/i.test(l));

  if (backLines.length > 0) {
    const blurbLines = backLines.filter(l => !/bestseller|award|prize|editors choice|notable book/i.test(l));
    metadata.notes = (blurbLines.length > 0 ? blurbLines : backLines).join(' ');
  }

  // 6. Extract Publisher from text
  const pubMatch = combinedText.match(/\b(Scholastic|Bloomsbury|Penguin|HarperCollins|Simon\s*&\s*Schuster|Macmillan|Oxford|Cambridge|Pearson|Wiley|O'Reilly|Routledge|Vintage|Anchor|Hachette|Crown|Ballantine|Bantam)\b/i);
  if (pubMatch) {
    metadata.publisher = pubMatch[1];
  } else {
    const genericPub = combinedText.match(/\b([A-Z][a-zA-Z\.\s&]+(?:Publishers?|Publishing|Press|Books|House|Media|Imprint))\b/i);
    if (genericPub && !/publishers?\s+weekly/i.test(genericPub[1])) {
      metadata.publisher = genericPub[1].trim();
    }
  }

  // Check URL for publisher name
  const urlMatch = combinedText.match(/www\.([a-zA-Z0-9_-]+)\.com/i);
  if (urlMatch && !metadata.publisher && urlMatch[1].length > 3) {
    metadata.publisher = urlMatch[1].charAt(0).toUpperCase() + urlMatch[1].slice(1);
  }

  // 7. Extract Front Cover Lines for Title & Author
  const frontLines = frontText
    .split(/\r?\n/)
    .map(l => l.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter(l => l.length > 2 && !/^(bestseller|award|winner|volume|edition|copyright|all rights|national|the extraordinary)/i.test(l));

  // Author detection
  const authorInitialsMatch = frontText.match(/\b([A-Z]\.?\s*[A-Z]\.?\s+[A-Z][a-zA-Z]+)\b/);
  if (authorInitialsMatch && !/^(AND|THE|NEW|USA|NOT)/i.test(authorInitialsMatch[1])) {
    metadata.author = toTitleCase(authorInitialsMatch[1].trim());
  } else {
    const explicitAuthor = frontLines.find(l => /^(?:by|written by|authored by)\s+[A-Za-z\.\s]+/i.test(l));
    if (explicitAuthor) {
      metadata.author = toTitleCase(explicitAuthor.replace(/^(?:by|written by|authored by)\s+/i, '').trim());
    } else {
      const authorCandidate = frontLines.find(l => /^[A-Z][a-zA-Z\.\s]{2,35}$/.test(l) && !/^(the|and)/i.test(l));
      if (authorCandidate) metadata.author = toTitleCase(authorCandidate);
    }
  }

  // Title detection: look at first 1-2 distinct lines of front cover
  if (frontLines.length > 0) {
    let t = frontLines[0];
    if (frontLines.length > 1 && /^(AND|THE|OF|FOR|IN|WITH|A|AN|&)\b/i.test(frontLines[1])) {
      t = `${frontLines[0]} ${frontLines[1]}`;
    }
    metadata.title = toTitleCase(t);
  }

  // 8. Find ISBN (from exact ISBN-13, ISBN-10, or candidate EAN-13 repair verified with OpenLibrary)
  let foundIsbn = '';

  // (a) Exact ISBN-13
  const raw13List = combinedText.match(/(?:9\s*7\s*[89](?:[-\s]?[0-9]){10})/g) || [];
  for (const r of raw13List) {
    const c = r.replace(/[^0-9]/g, '');
    if (c.length === 13 && validateIsbn13(c)) {
      foundIsbn = c;
      break;
    }
  }

  // (b) Exact ISBN-10
  if (!foundIsbn) {
    const raw10List = combinedText.match(/(?:[0-9Xx\s-]{10,18})/g) || [];
    for (const r of raw10List) {
      const c = r.replace(/[^0-9Xx]/gi, '').toUpperCase();
      if (c.length === 10 && validateIsbn10(c)) {
        foundIsbn = isbn10to13(c);
        break;
      }
    }
  }

  // (c) If raw 13-digit sequence had 1-digit OCR noise, test candidate repairs against OpenLibrary
  if (!foundIsbn && raw13List.length > 0) {
    for (const r of raw13List) {
      const c = r.replace(/[^0-9]/g, '');
      if (c.length === 13) {
        const candidates = [];
        for (let pos = 3; pos < 12; pos++) {
          for (let d = 0; d <= 9; d++) {
            const cand = c.slice(0, pos) + d + c.slice(pos + 1);
            if (validateIsbn13(cand)) candidates.push(cand);
          }
        }
        if (candidates.length > 0) {
          try {
            const bibkeys = candidates.map(cand => 'ISBN:' + cand).join(',');
            const rOl = await fetch(`https://openlibrary.org/api/books?bibkeys=${bibkeys}&jscmd=data&format=json`, { signal: AbortSignal.timeout(5000) });
            const jOl = await rOl.json();
            for (const cand of candidates) {
              const b = jOl['ISBN:' + cand];
              if (b) {
                // If title words match or author matches
                const tWords = (metadata.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
                const bTitle = (b.title || '').toLowerCase();
                if (tWords.some(w => bTitle.includes(w)) || (b.authors && metadata.author && b.authors.some(a => a.name.toLowerCase().includes(metadata.author.toLowerCase())))) {
                  foundIsbn = cand;
                  break;
                }
              }
            }
          } catch (e) {
            console.warn('Batch candidate verification failed:', e.message);
          }
        }
      }
      if (foundIsbn) break;
    }
  }

  metadata.isbn = foundIsbn;

  // 9. Enrich with OpenLibrary using verified ISBN
  if (metadata.isbn) {
    try {
      const olRes = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${metadata.isbn}&jscmd=data&format=json`, { signal: AbortSignal.timeout(5000) });
      const olData = await olRes.json();
      const bInfo = olData[`ISBN:${metadata.isbn}`];
      if (bInfo) {
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
      console.warn('OpenLibrary ISBN lookup error:', e.message);
    }
  }

  // 10. Fallback Search in OpenLibrary by Title + Author if still missing fields
  if (!metadata.title || !metadata.isbn || !metadata.year || !metadata.publisher) {
    try {
      const cleanTitle = (metadata.title || '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
      const titleWords = cleanTitle.split(/\s+/).filter(w => w.length > 2);
      const queryList = [
        [metadata.title, metadata.author].filter(Boolean).join(' '),
        [titleWords.slice(0, 2).join(' '), metadata.author].filter(Boolean).join(' '),
        [titleWords.slice(0, 2).join(' '), metadata.publisher].filter(Boolean).join(' '),
        titleWords.slice(0, 3).join(' ')
      ].filter(Boolean);

      let sData = null;
      for (const q of queryList) {
        if (q.length > 3) {
          const sUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=title,author_name,isbn,publisher,first_publish_year,subject&limit=8`;
          const sRes = await fetch(sUrl, { signal: AbortSignal.timeout(6000) });
          const j = await sRes.json();
          if (j.docs && j.docs.length > 0) {
            sData = j;
            break;
          }
        }
      }

      if (sData && sData.docs && sData.docs.length > 0) {
        // Find best matching doc based on title similarity
        let bestDoc = sData.docs[0];
        let bestScore = similarity(metadata.title, bestDoc.title || '');
        for (const doc of sData.docs) {
          const score = similarity(metadata.title, doc.title || '');
          if (score > bestScore) {
            bestScore = score;
            bestDoc = doc;
          }
        }

        if (bestDoc.title) metadata.title = bestDoc.title;
        if (!metadata.author && bestDoc.author_name) metadata.author = bestDoc.author_name.join(', ');
        if (!metadata.publisher && bestDoc.publisher) metadata.publisher = bestDoc.publisher[0];
        if (!metadata.year && bestDoc.first_publish_year) metadata.year = String(bestDoc.first_publish_year);
        if (!metadata.isbn && bestDoc.isbn && bestDoc.isbn.length) {
          const isbn13 = bestDoc.isbn.find(i => i.startsWith('978') || i.startsWith('979')) || bestDoc.isbn[0];
          metadata.isbn = isbn13;
        }
        if (!metadata.category && bestDoc.subject && bestDoc.subject.length) {
          metadata.category = bestDoc.subject[0];
        }
      }
    } catch (e) {
      console.warn('OpenLibrary dynamic search error:', e.message);
    }
  }

  return metadata;
}


module.exports = {
  extractBookMetadata: extractDynamicBook
};
