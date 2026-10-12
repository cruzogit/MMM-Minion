// Upload Vendor Quote reads PDFs in the browser with pdf.js, which runs in a worker script. The script is served from the site's own address
// (/pdf.worker.min.mjs) so it never depends on a bundler setting or on another website; this copies the one that belongs to the installed
// version of the package. Runs after `npm install` and before `dev` and `build` (see package.json); the copy is not committed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const from = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
const to = "public/pdf.worker.min.mjs";

if (!existsSync(from)) {
  console.warn(`copy-pdf-worker: ${from} not found (pdfjs-dist is not installed); PDFs cannot be read in the browser until it is.`);
} else {
  mkdirSync("public", { recursive: true });
  copyFileSync(from, to);
}
