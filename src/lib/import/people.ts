// Which person a name in an import file means. Shared by the Leads, Deals, Pre-Payment and Payment Collection imports.
import { looselySame, normalizeCode, normalizeStr, pickUnique } from "./sheet";

export type ImportUser = { id: string; name: string | null; email: string | null; employeeCode: string | null };

// Exact id, e-mail or employee code first; then the name; then, only when it points to one person, part of a name.
// "Kiruba 015" is how the old CRM exports a person: the name and the employee number. A name that two people share,
// or text that is not a name at all ("-", "N/A"), matches nobody: a guess between two people is worse than no match.
export function matchUser(users: ImportUser[], text: string): string | null {
  const clean = text.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const norm = normalizeStr(clean);

  const byId = pickUnique(users, u => u.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const byEmail = pickUnique(users, u => !!u.email && u.email.toLowerCase() === lower);
  if (byEmail) return byEmail.id;
  const byCode = pickUnique(users, u => !!u.employeeCode && normalizeCode(u.employeeCode) === normalizeCode(clean));
  if (byCode) return byCode.id;

  const trailing = clean.match(/^(.*?)[\s\-_]*(\d{1,6})$/);
  if (trailing && trailing[1].trim()) {
    const number = parseInt(trailing[2], 10);
    const rest = normalizeStr(trailing[1]);
    const byNumber = pickUnique(users, u => {
      const digits = u.employeeCode?.match(/(\d+)$/);
      return !!digits && parseInt(digits[1], 10) === number && looselySame(normalizeStr(u.name), rest);
    });
    if (byNumber) return byNumber.id;
  }

  if (!norm) return null;
  const byName = pickUnique(users, u => normalizeStr(u.name) === norm);
  if (byName) return byName.id;
  return pickUnique(users, u => looselySame(normalizeStr(u.name), norm))?.id ?? null;
}
