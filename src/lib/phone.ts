// Phone helpers. Numbers are stored as entered (we don't reformat what the
// advisor typed); we just present US 10/11-digit numbers nicely and build a
// tel: link that actually dials from a phone.

/** Strip to a dialable string (digits plus a leading +). */
export function telDigits(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  // Keep a leading + only.
  return cleaned.replace(/(?!^)\+/g, "");
}

/** "4195551234" → "(419) 555-1234"; leaves anything non-standard as typed. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw.trim();
}

export function telHref(raw: string): string {
  return `tel:${telDigits(raw)}`;
}
