/**
 * OCR for scanned / image documents (Tesseract.js + sharp preprocessing).
 * Turns photographed or scanned documents (PNG/JPG, or image-only PDFs) into text
 * so their contents can be extracted, saved, and made answerable by the assistant.
 */
import 'server-only';
import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // cachePath persists the language model across restarts (first run downloads it).
    workerPromise = createWorker('eng', 1, { cachePath: join(tmpdir(), 'hr-tesseract-cache') });
  }
  return workerPromise;
}

/** Preprocess (grayscale + normalize + upscale) then OCR an encoded image buffer. */
export async function ocrBuffer(input: Buffer): Promise<string> {
  let img: Buffer;
  try {
    img = await sharp(input)
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalize()
      .resize({ width: 1800, fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
  } catch {
    img = input; // not a sharp-decodable image; let tesseract try the raw bytes
  }
  const worker = await getWorker();
  const { data } = await worker.recognize(img);
  return (data.text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function ocrImage(bytes: ArrayBuffer): Promise<string> {
  return ocrBuffer(Buffer.from(bytes));
}

/** Best-effort OCR of embedded images in a (likely scanned) PDF. */
export async function ocrPdfImages(bytes: ArrayBuffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  let res: { pages?: { images?: unknown[] }[] } | null = null;
  try { res = await parser.getImage(); } finally { try { await (parser as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ } }
  const texts: string[] = [];
  for (const page of res?.pages ?? []) {
    for (const im of page.images ?? []) {
      const buf = toBuffer(im);
      if (buf) {
        const t = await ocrBuffer(buf).catch(() => '');
        if (t) texts.push(t);
      }
    }
  }
  return texts.join('\n').trim();
}

function toBuffer(im: unknown): Buffer | null {
  if (!im) return null;
  const obj = im as { data?: unknown; dataUrl?: unknown; base64?: unknown };
  if (Buffer.isBuffer(obj.data)) return obj.data;
  if (obj.data instanceof Uint8Array) return Buffer.from(obj.data);
  const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl : typeof im === 'string' ? im : null;
  if (dataUrl && dataUrl.startsWith('data:')) {
    const b64 = dataUrl.split(',')[1];
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
  if (typeof obj.base64 === 'string') return Buffer.from(obj.base64, 'base64');
  return null;
}
