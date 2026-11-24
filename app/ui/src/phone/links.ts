// Slice AND-2 (docs/contracts/android-phone.md §4.4, §9.3; NFR-SEC-01 AC-4, D-2192): which links leave through Android.
// Mirrors `open_url_allowed` in app/src-tauri/src/phone.rs.

/** True exactly when the trimmed URL parses and its scheme, case-insensitive, is `http`, `https`, `mailto` or `tel`. */
export function openUrlAllowed(url: string): boolean {
  const u = url.trim();
  const colon = u.indexOf(':');
  if (colon <= 0) return false;
  const scheme = u.slice(0, colon);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) return false;
  const rest = u.slice(colon + 1);
  switch (scheme.toLowerCase()) {
    case 'http':
    case 'https':
      return rest.startsWith('//') && rest.slice(2).split(/[/?#]/)[0].length > 0;
    case 'mailto':
    case 'tel':
      return rest.length > 0;
    default:
      return false;
  }
}
