/**
 * Document text extraction for RAG ingestion. Extracts text from:
 *   - PDFs (text layer via pdf-parse; falls back to OCR for scanned/image-only PDFs)
 *   - images (PNG/JPG/… via OCR)
 *   - plain-text files
 * so an uploaded document's contents become saved + answerable (owner-scoped).
 */
import 'server-only';
import { ocrImage, ocrPdfImages } from './ocr';

const MAX = 24000; // cap extracted text per document

export interface Extracted { text: string; method: 'pdf-text' | 'pdf-ocr' | 'image-ocr' | 'text' | 'none' }

export async function extractDocument(bytes: ArrayBuffer, contentType: string | null, filename: string): Promise<Extracted> {
  const ct = (contentType ?? '').toLowerCase();
  const name = filename.toLowerCase();
  try {
    if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|tiff?|bmp|heic)$/.test(name)) {
      return { text: (await ocrImage(bytes)).slice(0, MAX), method: 'image-ocr' };
    }
    if (ct.includes('pdf') || name.endsWith('.pdf')) {
      const text = await extractPdf(bytes);
      const alnum = text.replace(/[^a-z0-9]/gi, '').length;
      if (alnum >= 40) return { text: text.slice(0, MAX), method: 'pdf-text' };
      // Thin text layer → likely a scanned PDF. OCR its page images.
      const ocr = await ocrPdfImages(bytes).catch(() => '');
      if (ocr) return { text: ocr.slice(0, MAX), method: 'pdf-ocr' };
      return { text: text.slice(0, MAX), method: text ? 'pdf-text' : 'none' };
    }
    if (ct.startsWith('text/') || /\.(txt|md|csv|json)$/.test(name)) {
      return { text: new TextDecoder().decode(bytes).slice(0, MAX), method: 'text' };
    }
  } catch {
    /* fall through */
  }
  return { text: '', method: 'none' };
}

/** Back-compat: text only. */
export async function extractText(bytes: ArrayBuffer, contentType: string | null, filename: string): Promise<string> {
  return (await extractDocument(bytes, contentType, filename)).text;
}

async function extractPdf(bytes: ArrayBuffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    const res = await parser.getText();
    try { await (parser as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
    const text = (res?.text ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').trim();
    if (text) return text;
  } catch {
    /* fall through to crude extractor */
  }
  return crudePdf(Buffer.from(bytes));
}

function crudePdf(buf: Buffer): string {
  const s = buf.toString('latin1');
  const parts: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const t = m[1]!.replace(/\\([()\\])/g, '$1').replace(/\\[nrt]/g, ' ').trim();
    if (t && /[a-zA-Z0-9]/.test(t)) parts.push(t);
  }
  return parts.join(' ');
}
