// Example rows for the "Download Template" button of the import dialogs. Made up from the headings, so no real customer or
// employee ever has to be copied into the source code (this repository is public).

function sampleCell(header: string, n: number): string {
  const h = header.toLowerCase().trim();
  // Numbers the system gives out itself stay empty: an imported example must not collide with a real lead or deal
  if (/^(lead|deal|deals)\s*(number|id)$|^code$/.test(h)) return "";
  if (/\.id$|record id|project id|estimate id|selected quote|cust id|project link|location link/.test(h)) return "";
  if (/task person|assigned person|sales executive|deal owner|lead person/.test(h)) return "Employee Name 001";
  if (/phone|mobile|contact number/.test(h)) return `+91 90000 0000${n}`;
  if (/e-?mail/.test(h)) return `customer${n}@example.com`;
  if (/deal name|title/.test(h)) return `Sample Deal ${n}`;
  if (/customer name|lead name|^name$|contact person/.test(h)) return `Sample Customer ${n}`;
  if (/time spent/.test(h)) return "10";
  if (/quote status/.test(h)) return "Not Sent";
  if (/time/.test(h)) return `2026-04-0${n} 10:00:00`;
  if (/date/.test(h)) return `2026-04-0${n}`;
  if (/probab/.test(h)) return "50";
  if (/rate|exchange/.test(h)) return "1";
  if (/amount|value|revenue/.test(h)) return String(n * 50000);
  if (/city|^location$|site location/.test(h)) return "Chennai";
  if (/requirement/.test(h)) return "Sample requirement";
  if (/sub ?category/.test(h)) return "Residential";
  if (/category/.test(h)) return "Interior Design";
  if (/source/.test(h)) return "Website";
  if (/stage|status/.test(h)) return "Open";
  if (/currency/.test(h)) return "INR";
  return "";
}

/** `count` example rows for the given headings */
export function sampleRows(headers: readonly string[], count = 2): string[][] {
  return Array.from({ length: count }, (_, i) => headers.map(h => sampleCell(h, i + 1)));
}
