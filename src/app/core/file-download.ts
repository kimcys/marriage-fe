/** Download endpoints require an `Authorization: Bearer` header, which a
 * plain `<a href>`/browser navigation can never send -- only requests made
 * through HttpClient go through the auth interceptor. Callers fetch the file
 * as a blob via ApiService first, then hand it to one of these to actually
 * reach the user's disk/browser tab. */

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a blob in a new tab for inline viewing (PDF/image preview) instead
 * of forcing a save-to-disk. Left un-revoked -- the tab still needs the
 * object URL alive after this call returns. */
export function openBlob(blob: Blob): void {
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

/** Strips a filename's extension, e.g. for building "<name>-result.xlsx"
 * out of a source file's original name. */
export function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}
