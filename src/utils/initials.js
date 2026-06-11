export function computeInitials(fullName, email) {
  const src = fullName || email || '?';
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Ensures no two members share the same initials — appends a digit if needed */
export function uniqueInitials(base, existing) {
  if (!existing.some(m => m.initials === base)) return base;
  let n = 2;
  while (existing.some(m => m.initials === base + n)) n++;
  return base + n;
}
