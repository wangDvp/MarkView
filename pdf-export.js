/* Lazy PDF generation: local fonts, local library, selectable text. */
import pdfMake from './lib/pdf-vendor.js';
import { definition, CONTENT_WIDTH } from './pdf-content.js';

let fontsReady;

function initFonts() {
  if (!fontsReady) {
    fontsReady = (async () => {
      const vfs = {};
      for (const file of ['NotoSansSC-Regular.otf', 'NotoSansSC-Bold.otf']) {
        const response = await fetch(new URL(`./fonts/${file}`, import.meta.url), { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('PDF font unavailable');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 12 * 1024 * 1024) throw new Error('PDF font size');
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        }
        vfs[file] = btoa(binary);
      }
      pdfMake.addVirtualFileSystem(vfs);
      pdfMake.addFonts({ NotoSansSC: {
        normal: 'NotoSansSC-Regular.otf', bold: 'NotoSansSC-Bold.otf',
        italics: 'NotoSansSC-Regular.otf', bolditalics: 'NotoSansSC-Bold.otf',
      } });
      // All font/image bytes are supplied locally; the PDF engine fetches no URLs.
      pdfMake.setUrlAccessPolicy(() => false);
    })().catch((error) => { fontsReady = null; throw error; });
  }
  return fontsReady;
}

async function imageNodes(root, readImage) {
  const images = new Map();
  const deadline = Date.now() + 30000;
  let totalBytes = 0;
  let missingImages = 0;
  for (const image of root.querySelectorAll('img')) {
    try {
      if (Date.now() > deadline) throw new Error('image timeout');
      const source = new URL(image.getAttribute('src'), document.baseURI);
      if (!['https:', 'http:', 'data:', 'blob:', 'file:'].includes(source.protocol)) throw new Error('image URL');
      const blob = await readImage(source.href);
      if (totalBytes + blob.size > 20 * 1024 * 1024) throw new Error('image size');
      const bitmap = await createImageBitmap(blob);
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw new Error('image dimensions');
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1600 / bitmap.width, 1600 / bitmap.height);
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/png');
        totalBytes += data.length * 0.75;
        if (totalBytes > 20 * 1024 * 1024) throw new Error('image size');
        const ratio = Math.min(1, CONTENT_WIDTH / (canvas.width * 0.75), 600 / (canvas.height * 0.75));
        images.set(image, { image: data, width: canvas.width * 0.75 * ratio, height: canvas.height * 0.75 * ratio, margin: [0, 0, 0, 10] });
      } finally { bitmap.close(); }
    } catch {
      missingImages++;
      images.set(image, { text: `[图片：${image.alt || image.getAttribute('src') || '无法读取'}]`, color: '#59636e', margin: [0, 0, 0, 8] });
    }
  }
  return { images, missingImages };
}

export async function generate(root, name, options, readImage) {
  const [, result] = await Promise.all([initFonts(), imageNodes(root, readImage)]);
  const doc = definition(root, { name, baseUrl: options.baseUrl, images: result.images });
  const blob = await pdfMake.createPdf(doc).getBlob();
  return { blob, missingImages: result.missingImages };
}
