import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

export type BatchStatus = 'DRAFT' | 'QUEUED' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type DocumentType =
  | 'HANDWRITTEN_REGISTER'
  | 'HANDWRITTEN_CERAI_LEGACY'
  | 'HANDWRITTEN_CERAI_MODERN'
  | 'HANDWRITTEN_RUJUK_LEGACY'
  | 'HANDWRITTEN_RUJUK_MODERN'
  | 'TYPED_BORANG_4B'
  | 'TYPED_CERAI_LEGACY'
  | 'TYPED_CERAI_MODERN'
  | 'TYPED_RUJUK_LEGACY'
  | 'TYPED_RUJUK_MODERN';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type RecordStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type RecordType = 'NIKAH' | 'CERAI' | 'RUJUK';
export type ExportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ExportFormat = 'CSV' | 'XLSX';
export type OneDriveSubmissionStatus = 'PENDING' | 'FETCHING' | 'FETCHED' | 'FAILED';

/** Display labels for job rows -- a document's type is decided entirely by
 * the OneDrive-link auto-classification step now, never picked by a caller,
 * so the FE only ever needs to *display* it, not offer it as a form choice. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  HANDWRITTEN_REGISTER: 'Handwritten · Nikah',
  HANDWRITTEN_CERAI_LEGACY: 'Handwritten · Cerai (legacy)',
  HANDWRITTEN_CERAI_MODERN: 'Handwritten · Cerai (modern)',
  HANDWRITTEN_RUJUK_LEGACY: 'Handwritten · Rujuk (legacy)',
  HANDWRITTEN_RUJUK_MODERN: 'Handwritten · Rujuk (modern)',
  TYPED_BORANG_4B: 'Typed · Nikah (Borang 4B)',
  TYPED_CERAI_LEGACY: 'Typed · Cerai (legacy)',
  TYPED_CERAI_MODERN: 'Typed · Cerai (modern)',
  TYPED_RUJUK_LEGACY: 'Typed · Rujuk (legacy)',
  TYPED_RUJUK_MODERN: 'Typed · Rujuk (modern)',
};

export interface Paginated<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface BatchResponse {
  id: string;
  name: string;
  description: string | null;
  status: BatchStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobResponse {
  id: string;
  batch_id: string | null;
  document_id: string | null;
  status: JobStatus;
  document_type: DocumentType;
  page_number: number | null;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: { code: string; message: string } | null;
  links: { self: string; download: string | null };
}

export interface RecordResponse {
  id: string;
  job_id: string;
  batch_id: string | null;
  document_id: string | null;
  source_key: string;
  status: RecordStatus;
  field_values: Record<string, unknown>;
  confidence: number | null;
  validation_issues: string[];
  missing_fields: string[];
  original_filename: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RecordRevisionResponse {
  id: string;
  record_id: string;
  version: number;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reviewer: string | null;
  note: string | null;
  created_at: string;
}

export interface BulkApproveResponse {
  items: RecordResponse[];
}

export interface ExportResponse {
  id: string;
  batch_id: string;
  format: string;
  status: ExportStatus;
  storage_key: string | null;
  record_count: number | null;
  created_by: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SkippedFile {
  filename: string;
  status: string;
}

export interface OneDriveSubmissionResponse {
  id: string;
  batch_id: string;
  url: string;
  status: OneDriveSubmissionStatus;
  skipped_files: SkippedFile[] | null;
  created_at: string;
  updated_at: string;
  fetched_at: string | null;
  error: { code: string; message: string } | null;
}

function toHttpParams(input: Record<string, string | number | boolean | undefined | null>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      params = params.set(key, String(value));
    }
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  // ---- Batches ----

  createBatch(name: string, description?: string): Promise<BatchResponse> {
    return firstValueFrom(
      this.http.post<BatchResponse>(`${API_BASE}/batches`, { name, description: description ?? null }),
    );
  }

  listBatches(limit = 20, offset = 0): Promise<Paginated<BatchResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<BatchResponse>>(`${API_BASE}/batches`, {
        params: toHttpParams({ limit, offset }),
      }),
    );
  }

  getBatch(batchId: string): Promise<BatchResponse> {
    return firstValueFrom(this.http.get<BatchResponse>(`${API_BASE}/batches/${batchId}`));
  }

  /** Deletes the batch and everything scoped to it -- documents, jobs,
   * records, OneDrive submissions, exports -- irreversibly. */
  deleteBatch(batchId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API_BASE}/batches/${batchId}`));
  }

  // ---- OneDrive links ----
  // The only ingestion path: a link is fetched in the background, every file
  // it resolves to is auto-classified (a single link can mix handwritten/
  // typed, Nikah/Cerai/Rujuk content), and each routable file becomes its own
  // document + job. Posting a URL already submitted -- to this batch or any
  // other -- returns that submission's existing state unchanged instead of
  // re-fetching, unless it previously failed, in which case reposting it
  // retries the fetch (the same effect as retryOneDriveSubmission below).

  /** The backend returns 202 when the fetch actually started -- a genuinely
   * new submission, or a previously-FAILED one auto-retried by reposting
   * its URL -- and 200 when the URL was already submitted (to this batch or
   * any other) and still in flight or already fetched, so nothing new was
   * triggered. `isNew` surfaces that distinction so the caller can tell
   * "processing (again)" apart from "already tracked, this did nothing." */
  async submitOneDriveLink(batchId: string, url: string): Promise<{ submission: OneDriveSubmissionResponse; isNew: boolean }> {
    const response = await firstValueFrom(
      this.http.post<OneDriveSubmissionResponse>(`${API_BASE}/batches/${batchId}/onedrive-links`, { url }, {
        observe: 'response',
      }),
    );
    return { submission: response.body!, isNew: response.status === 202 };
  }

  listOneDriveLinks(
    batchId: string,
    limit = 20,
    offset = 0,
  ): Promise<Paginated<OneDriveSubmissionResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<OneDriveSubmissionResponse>>(`${API_BASE}/batches/${batchId}/onedrive-links`, {
        params: toHttpParams({ limit, offset }),
      }),
    );
  }

  /** Re-runs a FAILED submission's fetch+classify from scratch. A plain
   * repeat POST of the same link won't do this -- the backend's URL-dedup
   * returns the existing (failed) row unchanged and triggers no new fetch. */
  retryOneDriveSubmission(batchId: string, submissionId: string): Promise<OneDriveSubmissionResponse> {
    return firstValueFrom(
      this.http.post<OneDriveSubmissionResponse>(
        `${API_BASE}/batches/${batchId}/onedrive-links/${submissionId}/retry`,
        {},
      ),
    );
  }

  /** Deletes one OneDrive link and everything it caused to be ingested --
   * its documents, jobs, and records -- irreversibly. The batch itself and
   * anything ingested by its other links are untouched. */
  deleteOneDriveSubmission(batchId: string, submissionId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${API_BASE}/batches/${batchId}/onedrive-links/${submissionId}`),
    );
  }

  // ---- Jobs ----

  listJobs(filters: {
    status?: JobStatus;
    documentId?: string;
    batchId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Paginated<JobResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<JobResponse>>(`${API_BASE}/jobs`, {
        params: toHttpParams({
          status: filters.status,
          document_id: filters.documentId,
          batch_id: filters.batchId,
          limit: filters.limit ?? 20,
          offset: filters.offset ?? 0,
        }),
      }),
    );
  }

  getJob(jobId: string): Promise<JobResponse> {
    return firstValueFrom(this.http.get<JobResponse>(`${API_BASE}/jobs/${jobId}`));
  }

  retryJob(jobId: string): Promise<JobResponse> {
    return firstValueFrom(this.http.post<JobResponse>(`${API_BASE}/jobs/${jobId}/retry`, {}));
  }

  downloadJobUrl(jobId: string): string {
    return `${API_BASE}/jobs/${jobId}/download`;
  }

  /** The original source file (PDF/image) a record's values were OCR'd
   * from -- lets a reviewer open it to check the extracted data against
   * the actual scanned page. */
  documentDownloadUrl(batchId: string, documentId: string): string {
    return `${API_BASE}/batches/${batchId}/documents/${documentId}/download`;
  }

  // ---- Records ----

  listRecords(
    filters: {
      batchId?: string;
      status?: RecordStatus;
      q?: string;
      sourceUrl?: string;
      recordType?: RecordType;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Paginated<RecordResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<RecordResponse>>(`${API_BASE}/records`, {
        params: toHttpParams({
          batch_id: filters.batchId,
          status: filters.status,
          q: filters.q,
          source_url: filters.sourceUrl,
          record_type: filters.recordType,
          limit: filters.limit ?? 20,
          offset: filters.offset ?? 0,
        }),
      }),
    );
  }

  listJobRecords(
    jobId: string,
    filters: { status?: RecordStatus; limit?: number; offset?: number } = {},
  ): Promise<Paginated<RecordResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<RecordResponse>>(`${API_BASE}/jobs/${jobId}/records`, {
        params: toHttpParams({
          status: filters.status,
          limit: filters.limit ?? 100,
          offset: filters.offset ?? 0,
        }),
      }),
    );
  }

  getRecord(recordId: string): Promise<RecordResponse> {
    return firstValueFrom(this.http.get<RecordResponse>(`${API_BASE}/records/${recordId}`));
  }

  deleteRecord(recordId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API_BASE}/records/${recordId}`));
  }

  updateRecord(
    recordId: string,
    version: number,
    fieldValues: Record<string, unknown>,
    note?: string,
  ): Promise<RecordResponse> {
    return firstValueFrom(
      this.http.patch<RecordResponse>(`${API_BASE}/records/${recordId}`, {
        version,
        field_values: fieldValues,
        note: note ?? null,
      }),
    );
  }

  approveRecord(recordId: string, version: number, reason?: string): Promise<RecordResponse> {
    return firstValueFrom(
      this.http.post<RecordResponse>(`${API_BASE}/records/${recordId}/approve`, {
        version,
        reason: reason ?? null,
      }),
    );
  }

  rejectRecord(recordId: string, version: number, reason?: string): Promise<RecordResponse> {
    return firstValueFrom(
      this.http.post<RecordResponse>(`${API_BASE}/records/${recordId}/reject`, {
        version,
        reason: reason ?? null,
      }),
    );
  }

  bulkApproveRecords(recordIds: string[], reviewer?: string): Promise<BulkApproveResponse> {
    return firstValueFrom(
      this.http.post<BulkApproveResponse>(`${API_BASE}/records/bulk-approve`, {
        record_ids: recordIds,
        reviewer: reviewer ?? null,
      }),
    );
  }

  listRecordRevisions(
    recordId: string,
    limit = 20,
    offset = 0,
  ): Promise<Paginated<RecordRevisionResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<RecordRevisionResponse>>(`${API_BASE}/records/${recordId}/revisions`, {
        params: toHttpParams({ limit, offset }),
      }),
    );
  }

  // ---- Exports ----

  createExport(
    batchId: string,
    format: ExportFormat = 'XLSX',
    includeUnreviewed = true,
  ): Promise<ExportResponse> {
    return firstValueFrom(
      this.http.post<ExportResponse>(`${API_BASE}/exports`, {
        batch_id: batchId,
        format,
        include_unreviewed: includeUnreviewed,
      }),
    );
  }

  listExports(filters: { limit?: number; offset?: number } = {}): Promise<Paginated<ExportResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<ExportResponse>>(`${API_BASE}/exports`, {
        params: toHttpParams({ limit: filters.limit ?? 20, offset: filters.offset ?? 0 }),
      }),
    );
  }

  getExport(exportId: string): Promise<ExportResponse> {
    return firstValueFrom(this.http.get<ExportResponse>(`${API_BASE}/exports/${exportId}`));
  }

  downloadExportUrl(exportId: string): string {
    return `${API_BASE}/exports/${exportId}/download`;
  }

  deleteExport(exportId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API_BASE}/exports/${exportId}`));
  }
}
