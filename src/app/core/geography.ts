/**
 * Daerah (district) -> negeri (state) lookup, used to auto-populate a
 * batch's negeri once a known daerah is picked. Only Selangor's 9 daerah
 * are covered today -- daerah for other negeri aren't enumerated yet, so
 * both fields stay free text on the batch itself (see
 * batches/models.py::Batch.daerah/negeri) rather than a closed enum: a
 * batch for an uncovered negeri can still have its daerah typed in freely
 * and its negeri set independently, just without the auto-fill.
 *
 * Extend this as more states are covered -- nothing else needs to change,
 * the batch add/edit forms and this map are the only place daerah/negeri
 * coverage lives.
 */
export const DAERAH_TO_NEGERI: Record<string, string> = {
  Gombak: 'Selangor',
  'Hulu Langat': 'Selangor',
  'Hulu Selangor': 'Selangor',
  Klang: 'Selangor',
  'Kuala Langat': 'Selangor',
  'Kuala Selangor': 'Selangor',
  Petaling: 'Selangor',
  'Sabak Bernam': 'Selangor',
  Sepang: 'Selangor',
};

export const KNOWN_DAERAH: string[] = Object.keys(DAERAH_TO_NEGERI).sort();

/** Case-insensitive lookup -- returns undefined for a daerah not covered
 * yet, so the caller can leave negeri exactly as the user already typed
 * rather than clobbering it. */
export function negeriForDaerah(daerah: string): string | undefined {
  const trimmed = daerah.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = Object.keys(DAERAH_TO_NEGERI).find((known) => known.toLowerCase() === trimmed.toLowerCase());
  return match ? DAERAH_TO_NEGERI[match] : undefined;
}
