/**
 * After an update, a tab opened on the previous version asks for page files
 * that no longer exist. Reloading picks up the new version; this does it at
 * most once a minute, so a page that is broken for another reason can't
 * reload forever.
 */

const KEY = "badya.reloadedForUpdate";

/** An error from loading one of the app's own files — the sign of an update since the tab was opened. */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(message);
}

/** Reload to get the new version — unless that was just tried. Returns whether it reloads. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No storage (private mode): reloading once is still the best bet.
  }
  window.location.reload();
  return true;
}
