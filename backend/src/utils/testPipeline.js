const sharp = require('sharp');
const Tesseract = require('tesseract.js');

async function testFullPipeline(frontPath, backPath) {
  console.log('Starting full pipeline test...');
  const backSharp = sharp(backPath);
  const backStats = await backSharp.stats();
  const backBrightness = (backStats.channels[0].mean + backStats.channels[1].mean + backStats.channels[2].mean) / 3;
  console.log('Back cover brightness:', backBrightness.toFixed(1));

  // If dark background (< 128), negate (invert) so light text becomes dark on white!
  let backPipeline = sharp(backPath).resize(900, null, { withoutEnlargement: false }).grayscale();
  if (backBrightness < 128) {
    backPipeline = backPipeline.negate();
  }
  const backBuf = await backPipeline.normalize().toBuffer();

  // Also extract barcode box area (bottom right 65% width x 25% height)
  const meta = await sharp(backPath).metadata();
  const boxW = Math.round(meta.width * 0.65);
  const boxH = Math.round(meta.height * 0.25);
  const boxBuf = await sharp(backPath)
    .extract({ left: meta.width - boxW, top: meta.height - boxH, width: boxW, height: boxH })
    .resize(boxW * 4, boxH * 4)
    .grayscale()
    .normalize()
    .toBuffer();

  // Preprocess Front Cover
  const frontBuf = await sharp(frontPath)
    .resize(900, null, { withoutEnlargement: false })
    .grayscale()
    .normalize()
    .toBuffer();

  const [resBack, resBox, resFront] = await Promise.all([
    Tesseract.recognize(backBuf, 'eng'),
    Tesseract.recognize(boxBuf, 'eng'),
    Tesseract.recognize(frontBuf, 'eng')
  ]);

  const rawBack = resBack.data.text;
  const rawBox = resBox.data.text;
  const rawFront = resFront.data.text;

  console.log('=== RAW BACK TEXT ===\n', rawBack);
  console.log('=== RAW BARCODE BOX ===\n', rawBox);
  console.log('=== RAW FRONT TEXT ===\n', rawFront);
}

const f = 'C:/Users/azim4/.gemini/antigravity-ide/brain/6c9c503e-b13f-4a69-8449-ae1ded79e361/.user_uploaded/media_1792389823835.jpg';
const b = 'C:/Users/azim4/.gemini/antigravity-ide/brain/6c9c503e-b13f-4a69-8449-ae1ded79e361/.user_uploaded/media_1792389837409.jpg';
testFullPipeline(f, b).catch(console.error);
