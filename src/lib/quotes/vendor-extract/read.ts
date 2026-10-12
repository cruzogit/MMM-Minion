// Reading a vendor's quotation file in the browser: PDF (its text, or OCR when it is a scan), Excel / CSV, or a picture (OCR). The file never leaves the
// browser; the engines (pdf.js, Tesseract, the spreadsheet reader) are loaded only when a file is picked.

import { ImportFileError, readSheetMatrices } from "@/lib/import/sheet";
import { extractFromMatrix, extractFromTokens, type Extracted, type Token } from "./table";

export const VENDOR_FILE_TYPES = ".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";
export const VENDOR_MAX_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_OCR_PAGES = 8;
const MIN_WORD_CONFIDENCE = 25;

export type Progress = (message: string, fraction?: number) => void;
export type ExtractResult = Extracted & { source: "pdf" | "pdf-scan" | "sheet" | "image" };

export function fileKind(file: { name: string; type?: string }): "pdf" | "sheet" | "image" | null {
  const name = file.name.toLowerCase();
  const type = file.type ?? "";
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (/\.(xlsx|xls|csv)$/.test(name) || type.includes("spreadsheet") || type === "text/csv" || type === "application/vnd.ms-excel") return "sheet";
  if (/\.(png|jpe?g|webp|bmp|tiff?)$/.test(name) || type.startsWith("image/")) return "image";
  return null;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
type PdfJs = typeof import("pdfjs-dist");
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

/** The words (with their position on the page) of a PDF that has a text layer */
export async function pdfTokens(doc: PdfDoc, pdfjs: PdfJs, pages: number, onProgress?: Progress): Promise<{ tokens: Token[]; chars: number }> {
  const tokens: Token[] = [];
  let chars = 0;
  for (let p = 1; p <= pages; p++) {
    onProgress?.(`Reading page ${p} of ${pages}…`, p / pages);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const m = pdfjs.Util.transform(vp.transform, item.transform); // to the page as seen: x right, y down
      const height = Math.hypot(m[2], m[3]) || item.height || 10;
      const width = (item.width || 0) * (vp.scale || 1);
      chars += item.str.length;
      tokens.push({ text: item.str, x0: m[4], x1: m[4] + (width || item.str.length * height * 0.5), y0: m[5] - height, y1: m[5], page: p });
    }
  }
  return { tokens, chars };
}

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  // The worker file is copied to /public when the packages are installed (scripts/copy-pdf-worker.mjs). In Node (tests) pdf.js needs no setting.
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

async function openPdf(pdfjs: PdfJs, bytes: Uint8Array): Promise<{ doc: PdfDoc; close: () => void }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (e) {
    void task.destroy();
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new Error("This PDF is password protected. Remove the password and upload it again.");
    throw new Error("This PDF could not be read. Please check that the file is a valid PDF.");
  }
}

// ---------------------------------------------------------------------------
// OCR (scans and pictures)
// ---------------------------------------------------------------------------
type OcrImage = HTMLCanvasElement | Blob;

export async function ocrTokens(images: OcrImage[], onProgress?: Progress): Promise<Token[]> {
  const tesseract = await import("tesseract.js");
  onProgress?.("Starting the text reader…");
  let current = 0;
  const worker = await tesseract.createWorker("eng", 1, {
    logger: m => {
      if (m.status === "recognizing text") onProgress?.(`Reading the text of ${images.length > 1 ? `page ${current + 1} of ${images.length}` : "the picture"}… ${Math.round(m.progress * 100)}%`, (current + m.progress) / images.length);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM?.SINGLE_BLOCK ?? ("6" as never), preserve_interword_spaces: "1" });
    const tokens: Token[] = [];
    for (; current < images.length; current++) {
      const { data } = await worker.recognize(images[current], {}, { blocks: true });
      for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) for (const w of line.words) {
        const text = w.text.trim();
        if (!text || w.confidence < MIN_WORD_CONFIDENCE) continue;
        tokens.push({ text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, page: current + 1 });
      }
    }
    return tokens;
  } finally {
    await worker.terminate();
  }
}

async function renderPages(doc: PdfDoc, pages: number, onProgress?: Progress): Promise<HTMLCanvasElement[]> {
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= pages; p++) {
    onProgress?.(`Preparing page ${p} of ${pages}…`, p / pages);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot prepare the page for reading.");
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    out.push(canvas);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------
/** The item rows of a vendor quotation file. Throws an Error whose message can be shown to the person as it is. */
export async function extractVendorQuote(file: File, onProgress: Progress = () => undefined): Promise<ExtractResult> {
  if (file.size > VENDOR_MAX_BYTES) throw new Error(`The file is larger than ${VENDOR_MAX_BYTES / 1024 / 1024} MB. Upload a smaller file.`);
  if (file.size === 0) throw new Error("The file is empty.");
  const kind = fileKind(file);
  if (!kind) throw new Error("Upload a PDF, Excel (.xlsx, .xls), CSV or picture (JPG, PNG) file.");

  if (kind === "sheet") {
    onProgress("Reading the spreadsheet…");
    const XLSX = await import("xlsx");
    let sheets: string[][][];
    try {
      sheets = readSheetMatrices(XLSX, await file.arrayBuffer());
    } catch (e) {
      throw new Error(e instanceof ImportFileError ? e.message : "The spreadsheet could not be read.");
    }
    let best: Extracted | null = null;
    for (const m of sheets) {
      const r = extractFromMatrix(m);
      if (!best || r.rows.length > best.rows.length) best = r;
    }
    return { ...(best ?? { rows: [], warnings: [], headerFound: false }), source: "sheet" };
  }

  if (kind === "image") {
    const tokens = await ocrTokens([file], onProgress);
    if (!tokens.length) throw new Error("No text could be read from the picture. Try a sharper, straighter picture.");
    const r = extractFromTokens(tokens);
    r.warnings.unshift("The picture was read with text recognition: please check every row.");
    return { ...r, source: "image" };
  }

  onProgress("Opening the PDF…");
  const pdfjs = await loadPdfJs();
  const { doc, close } = await openPdf(pdfjs, new Uint8Array(await file.arrayBuffer()));
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const { tokens, chars } = await pdfTokens(doc, pdfjs, pages, onProgress);
    if (chars >= 20 * pages) {
      const r = extractFromTokens(tokens);
      if (doc.numPages > pages) r.warnings.push(`Only the first ${pages} pages were read.`);
      return { ...r, source: "pdf" };
    }
    // a scan: no text in it, so each page is drawn and read as a picture
    const ocrPages = Math.min(pages, MAX_OCR_PAGES);
    const canvases = await renderPages(doc, ocrPages, onProgress);
    const scanned = await ocrTokens(canvases, onProgress);
    if (!scanned.length) throw new Error("No text could be read from this PDF. Try a sharper scan.");
    const r = extractFromTokens(scanned);
    r.warnings.unshift("This PDF is a scan; it was read with text recognition. Please check every row.");
    if (doc.numPages > ocrPages) r.warnings.push(`Only the first ${ocrPages} pages were read.`);
    return { ...r, source: "pdf-scan" };
  } finally {
    close();
  }
}
