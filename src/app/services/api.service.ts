import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

export type BatchStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
export type DocumentType = 'HANDWRITTEN_REGISTER' | 'TYPED_BORANG_4B';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type RecordStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type ExportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ExportFormat = 'CSV' | 'XLSX';

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

export interface DocumentResponse {
  id: string;
  batch_id: string;
  original_filename: string;
  safe_filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  status: DocumentStatus;
  document_type: DocumentType;
  page_count: number | null;
  created_at: string;
  updated_at: string;
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
  source_key: string;
  status: RecordStatus;
  field_values: Record<string, unknown>;
  confidence: number | null;
  validation_issues: string[];
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

  // ---- Documents ----

  uploadDocument(
    batchId: string,
    file: File,
    documentType: DocumentType = 'HANDWRITTEN_REGISTER',
  ): Promise<DocumentResponse> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    return firstValueFrom(
      this.http.post<DocumentResponse>(`${API_BASE}/batches/${batchId}/documents`, form),
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

  // ---- Records ----

  listRecords(
    filters: { batchId?: string; status?: RecordStatus; limit?: number; offset?: number } = {},
  ): Promise<Paginated<RecordResponse>> {
    return firstValueFrom(
      this.http.get<Paginated<RecordResponse>>(`${API_BASE}/records`, {
        params: toHttpParams({
          batch_id: filters.batchId,
          status: filters.status,
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
