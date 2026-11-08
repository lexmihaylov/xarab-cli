// Diagnostics are suggestions only; matching and mutation remain the caller's responsibility.
export function formatMismatchDiagnostics(original, requested, matches) {
  if (matches.length) {
    const positions = matches.slice(0, 5).map(({ index }) => {
      const before = original.slice(0, index);
      return `line ${1 + (before.match(/\n/g) || []).length}`;
    });
    return ` Match locations: ${positions.join(", ")}${matches.length > 5 ? ", …" : ""}.`;
  }

  // Compare a bounded first line after trimming whitespace, without using it as a match.
  const needle = requested.split(/\r?\n/, 1)[0].trim();
  if (!needle || needle.length > 200) return "";
  const lines = original.split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length && candidates.length < 3; i += 1) {
    if (lines[i].trim() === needle) {
      const excerpt = lines[i].slice(0, 160).replace(/[\t\r\x00-\x1f\x7f]/g, " ");
      candidates.push(`line ${i + 1}: ${excerpt}${lines[i].length > 160 ? "…" : ""}`);
    }
  }
  return candidates.length
    ? ` Possible whitespace-only first-line candidates (not matches): ${candidates.join("; ")}.`
    : "";
}
