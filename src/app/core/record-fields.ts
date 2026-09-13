import { RecordType } from '../services/api.service';

/**
 * The full set of columns a record of each type can ever carry, core and
 * optional alike -- both the typed pipeline's export headers
 * (marriage-ocr's src/marriage_ocr/typed/csv_writer.py::TYPED_CSV_COLUMNS)
 * and the handwritten pipeline's (src/marriage_ocr/exporter.py::XLSX_COLUMNS),
 * unioned. The two pipelines sometimes name the same concept differently
 * (e.g. Cerai/Rujuk's typed "IC Suami" vs. its own "IC Suami Raw" backup
 * text) -- both spellings are kept so a column doesn't vanish just because
 * a batch mixes typed and handwritten sources.
 *
 * NIKAH deliberately omits several columns both pipelines still emit under
 * the hood (ID Suami/Isteri Raw, Mas Kahwin Raw, Tarikh Keluar Raw, IC Wali/
 * No Kad Pengenalan/Passport Wali, IC Saksi 1/2, Pemberian Lain, and Nikah's
 * copy of Jumlah Bayaran/Tarikh Lahir Suami/Tarikh Lahir Isteri) -- per
 * explicit client request, these either duplicated an already-parsed
 * sibling column under a different name, or added Nikah-only clutter with
 * no distinct information. marriage-ocr's csv_writer.py/exporter.py were
 * updated in lockstep to stop emitting them for Nikah rows specifically
 * (Jumlah Bayaran/Tarikh Lahir Suami/Isteri stay real, populated columns
 * for Cerai/Rujuk, which is why they're still listed below).
 *
 * Used so the records table always shows every field this record type
 * supports, not just whichever ones happen to be non-empty in the records
 * currently loaded (a genuinely blank/failed optional field should still
 * show as an empty column, not disappear as if it never existed).
 *
 * Keep this in sync by hand with the two column lists above when either
 * pipeline's fields change -- there is no API endpoint (yet) that reports
 * a record type's schema, so this is this project's version of the
 * MARRIAGE_OCR_GIT_REF multi-file sync problem: nothing enforces it, so a
 * newly-added backend field silently stops appearing here until someone
 * remembers to add it to this list too.
 */
export const RECORD_TYPE_FIELDS: Record<RecordType, string[]> = {
  NIKAH: [
    'Bil',
    'No Siri',
    'Tarikh Nikah',
    'Tarikh Nikah Hijri',
    'Tarikh Daftar',
    'Nama Suami',
    'IC Lama Suami',
    'IC Baru Suami',
    'Umur Suami',
    'Warganegara Suami',
    'Bangsa Suami',
    'Alamat Suami',
    'Nama Isteri',
    'IC Lama Isteri',
    'IC Baru Isteri',
    'Umur Isteri',
    'Warganegara Isteri',
    'Bangsa Isteri',
    'Alamat Isteri',
    'Nama Wali',
    'Umur Wali',
    'Hubungan Wali',
    'Alamat Wali',
    'Saksi 1',
    'Saksi 2',
    'Hari Nikah',
    'Masa Nikah',
    'Tempat Nikah',
    'Daerah',
    'Negeri',
    'Nama Pendaftar',
    'Alamat Pendaftar',
    'Pernikahan Kali',
    'Isteri Ke',
    'Mas Kahwin',
    'Belanja Hantaran',
    'Tarikh Keluar',
    'Remarks',
    'Record Type',
  ],
  CERAI: [
    'Bil',
    'No Rujukan',
    'No Siri',
    'Tarikh Daftar',
    'Tarikh Daftar Hijri',
    'Nama Suami',
    'Umur Suami',
    'IC Suami',
    'IC Suami Raw',
    'Bangsa Suami',
    'Warganegara Suami',
    'Alamat Suami',
    'Pekerjaan Suami',
    'Tarikh Lahir Suami',
    'Nama Isteri',
    'Umur Isteri',
    'IC Isteri',
    'IC Isteri Raw',
    'Bangsa Isteri',
    'Warganegara Isteri',
    'Alamat Isteri',
    'Pekerjaan Isteri',
    'Tarikh Lahir Isteri',
    'Bil Daftar Nikah',
    'Bil Daftar Rujuk Asal',
    'Bil Daftar Rujukan',
    'Bilangan Kes Mal',
    'No Sijil Perakuan Nikah Rujuk',
    'No Permohonan Cerai',
    'Tempat Nikah Daerah',
    'Tempat Nikah Negeri',
    'Tarikh Nikah',
    'Tarikh Nikah Hijri',
    'Tempat Cerai',
    'Tempat Bercerai',
    'Keadaan Talak',
    'Cerai Dalam Keadaan',
    'Talak Kali Ke',
    'Jumlah Talak',
    'Bayaran Tebus Talak',
    'Tarikh Cerai',
    'Tarikh Cerai Raw',
    'Tarikh Cerai Hijri',
    'Saksi 1',
    'Saksi 2',
    'Jumlah Bayaran',
    'Nama Pendaftar',
    'Jawatan Pendaftar',
    'Catatan Raw',
    'Hal Hal Lain',
    'No Telefon',
    'Tarikh Keluar',
    'Tarikh Keluar Raw',
    'Record Type',
  ],
  RUJUK: [
    'Bil',
    'No Rujukan',
    'No Siri',
    'Tarikh Daftar',
    'Tarikh Daftar Hijri',
    'Nama Suami',
    'Umur Suami',
    'IC Suami',
    'IC Suami Raw',
    'Bangsa Suami',
    'Warganegara Suami',
    'Alamat Suami',
    'Alamat Pejabat Suami',
    'Pekerjaan Suami',
    'Tarikh Masuk Islam Suami',
    'No Kad Perakuan Islam Suami',
    'Nama Isteri',
    'Umur Isteri',
    'IC Isteri',
    'IC Isteri Raw',
    'Bangsa Isteri',
    'Warganegara Isteri',
    'Alamat Isteri',
    'Alamat Pejabat Isteri',
    'Pekerjaan Isteri',
    'Tarikh Masuk Islam Isteri',
    'No Kad Perakuan Islam Isteri',
    'Tempat Rujuk',
    'Tempat Nikah Daerah',
    'Tempat Nikah Negeri',
    'Bil Cerai',
    'Rujuk Kali',
    'Bil Daftar Nikah',
    'Tarikh Nikah',
    'Tarikh Nikah Hijri',
    'Tarikh Cerai',
    'Tarikh Cerai Raw',
    'Tarikh Cerai Hijri',
    'Tarikh Rujuk',
    'Tarikh Rujuk Raw',
    'Tarikh Rujuk Hijri',
    'Nama Pendaftar',
    'Jawatan Pendaftar',
    'Catatan Raw',
    'Hal Hal Lain',
    'No Telefon',
    'Jumlah Bayaran',
    'Tarikh Keluar',
    'Tarikh Keluar Raw',
    'Record Type',
  ],
};

const KNOWN_RECORD_TYPES = new Set<string>(Object.keys(RECORD_TYPE_FIELDS));

export function isKnownRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && KNOWN_RECORD_TYPES.has(value);
}
