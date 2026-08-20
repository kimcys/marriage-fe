import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import {
  ApiService,
  BatchResponse,
  DocumentType,
  ExportFormat,
  ExportResponse,
  JobResponse,
  JobStatus,
  RecordResponse,
  RecordStatus,
} from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

interface EditableRecord extends RecordResponse {
  editing?: boolean;
  editValues?: Record<string, string>;
  selected?: boolean;
  saving?: boolean;
}

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

interface PendingUpload {
  id: number;
  file: File;
  status: UploadStatus;
  errorMessage?: string;
}

type StatusFilter<T extends string> = T | 'ALL';

const JOBS_PAGE_SIZE = 50;
const JOBS_ROW_HEIGHT = 56;
const JOBS_LOAD_MORE_THRESHOLD = 15;
const RECORDS_PAGE_SIZE = 20;
const NON_TERMINAL_JOB_STATUSES: JobStatus[] = ['PENDING', 'PROCESSING'];

@Component({
  selector: 'app-batch-detail',
  imports: [FormsModule, RouterLink, ScrollingModule, NgTemplateOutlet],
  templateUrl: './batch-detail.page.html',
})
export class BatchDetailPage implements OnInit, OnDestroy {
  protected readonly jobsRowHeight = JOBS_ROW_HEIGHT;

  protected readonly batch = signal<BatchResponse | null>(null);

  // ---- Jobs: virtualized + incrementally fetched, optionally status-filtered ----
  protected readonly jobs = signal<JobResponse[]>([]);
  protected readonly jobsTotal = signal(0);
  protected readonly jobsLoadingMore = signal(false);
  protected jobsStatusFilter: StatusFilter<JobStatus> = 'ALL';

  // Records are loaded on demand, one job at a time, and keyed by job id --
  // never accumulated into one unbounded flat array. A document that splits
  // into thousands of per-page jobs must not force the browser to hold
  // every page's records in memory at once.
  protected readonly expandedJobIds = signal<Set<string>>(new Set());
  protected readonly jobRecords = signal<Record<string, EditableRecord[]>>({});
  protected readonly loadingRecordsForJob = signal<Set<string>>(new Set());

  // ---- Batch-wide records review queue: paginated + status-filterable,
  // using the batch_id-filtered records endpoint so a reviewer can work
  // through "all PENDING_REVIEW records in this batch" without manually
  // opening each job's panel one at a time. ----
  protected readonly batchRecords = signal<EditableRecord[]>([]);
  protected readonly batchRecordsTotal = signal(0);
  protected readonly batchRecordsOffset = signal(0);
  protected readonly batchRecordsLoading = signal(false);
  protected batchRecordsStatusFilter: StatusFilter<RecordStatus> = 'PENDING_REVIEW';
  protected readonly batchRecordsPageSize = RECORDS_PAGE_SIZE;

  protected readonly exports = signal<ExportResponse[]>([]);
  protected readonly uploading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly pendingUploads = signal<PendingUpload[]>([]);

  protected documentType: DocumentType = 'HANDWRITTEN_REGISTER';
  protected exportFormat: ExportFormat = 'XLSX';

  private batchId!: string;
  private nextUploadId = 1;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.batchId = this.route.snapshot.paramMap.get('id')!;
    void this.loadAll();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    const additions: PendingUpload[] = files.map((file) => ({
      id: this.nextUploadId++,
      file,
      status: 'pending',
    }));
    this.pendingUploads.update((existing) => [...existing, ...additions]);
    // Allow re-selecting the same file(s) again later (e.g. after removing
    // one from the list) -- without this the change event won't fire twice
    // for an identical file selection.
    input.value = '';
  }

  removePendingUpload(upload: PendingUpload): void {
    this.pendingUploads.update((existing) => existing.filter((u) => u.id !== upload.id));
  }

  hasUploadableFiles(): boolean {
    return this.pendingUploads().some((u) => u.status === 'pending' || u.status === 'error');
  }

  async uploadDocuments(): Promise<void> {
    const toUpload = this.pendingUploads().filter((u) => u.status === 'pending' || u.status === 'error');
    if (toUpload.length === 0) {
      return;
    }
    this.uploading.set(true);
    let succeeded = 0;
    let failed = 0;
    try {
      // Uploaded one at a time, not in parallel: OCR_MAX_CONCURRENT_JOBS is
      // typically 1, so parallel uploads wouldn't process any faster --
      // sequential keeps per-file progress simple to follow and avoids
      // hammering the API with a burst of simultaneous multipart uploads
      // when someone selects a few hundred files at once.
      for (const upload of toUpload) {
        this.updateUpload(upload.id, { status: 'uploading', errorMessage: undefined });
        try {
          await this.api.uploadDocument(this.batchId, upload.file, this.documentType);
          this.updateUpload(upload.id, { status: 'done' });
          succeeded += 1;
        } catch (error) {
          const message = error instanceof ApiClientError ? error.friendlyMessage() : 'Upload failed.';
          this.updateUpload(upload.id, { status: 'error', errorMessage: message });
          failed += 1;
        }
      }
      await this.loadJobs();
      this.startPolling();
      if (succeeded > 0) {
        this.toast.success(`Uploaded ${succeeded} file${succeeded === 1 ? '' : 's'}.`);
      }
      if (failed > 0) {
        this.toast.error(`${failed} file${failed === 1 ? '' : 's'} failed to upload. Fix and retry below.`);
      }
    } finally {
      this.uploading.set(false);
    }
  }

  private updateUpload(id: number, patch: Partial<PendingUpload>): void {
    this.pendingUploads.update((existing) => existing.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async retryJob(job: JobResponse): Promise<void> {
    try {
      await this.api.retryJob(job.id);
      await this.refreshLoadedJobs();
      this.startPolling();
    } catch (error) {
      this.handleError(error);
    }
  }

  downloadJobUrl(job: JobResponse): string {
    return this.api.downloadJobUrl(job.id);
  }

  // ---- Jobs: virtualized + incrementally fetched ----

  async onJobsStatusFilterChanged(): Promise<void> {
    await this.loadJobs();
    this.startPolling();
  }

  onScrolledIndexChanged(index: number): void {
    const loaded = this.jobs().length;
    const nearEnd = index + JOBS_LOAD_MORE_THRESHOLD >= loaded;
    if (nearEnd && loaded < this.jobsTotal() && !this.jobsLoadingMore()) {
      void this.loadMoreJobs();
    }
  }

  private jobsFilterParam(): JobStatus | undefined {
    return this.jobsStatusFilter === 'ALL' ? undefined : this.jobsStatusFilter;
  }

  private async loadJobs(): Promise<void> {
    const page = await this.api.listJobs({
      batchId: this.batchId,
      status: this.jobsFilterParam(),
      limit: JOBS_PAGE_SIZE,
      offset: 0,
    });
    this.jobs.set(page.items);
    this.jobsTotal.set(page.total);
  }

  private async loadMoreJobs(): Promise<void> {
    this.jobsLoadingMore.set(true);
    try {
      const page = await this.api.listJobs({
        batchId: this.batchId,
        status: this.jobsFilterParam(),
        limit: JOBS_PAGE_SIZE,
        offset: this.jobs().length,
      });
      this.jobs.update((existing) => [...existing, ...page.items]);
      this.jobsTotal.set(page.total);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.jobsLoadingMore.set(false);
    }
  }

  /** Re-fetches only the jobs already loaded in the browser, to pick up status
   * transitions (PENDING -> PROCESSING -> COMPLETED) without re-downloading
   * the whole (potentially huge) job list on every poll tick. */
  private async refreshLoadedJobs(): Promise<void> {
    const loadedCount = this.jobs().length;
    if (loadedCount === 0) {
      await this.loadJobs();
      return;
    }
    try {
      const page = await this.api.listJobs({
        batchId: this.batchId,
        status: this.jobsFilterParam(),
        limit: loadedCount,
        offset: 0,
      });
      this.jobs.set(page.items);
      this.jobsTotal.set(page.total);

      // If a job just completed while its records panel was already open,
      // load its records automatically instead of leaving an empty panel.
      for (const job of page.items) {
        if (
          job.status === 'COMPLETED' &&
          this.expandedJobIds().has(job.id) &&
          this.jobRecords()[job.id] === undefined
        ) {
          void this.loadRecordsForJob(job.id);
        }
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  // ---- Adaptive polling: only keep polling while something loaded is
  // still PENDING/PROCESSING. A batch that has fully settled (every loaded
  // job terminal, and nothing left unfetched) stops polling entirely
  // instead of hitting the API forever at a fixed interval. ----

  private startPolling(): void {
    this.stopPolling();
    this.pollHandle = setInterval(() => void this.pollTick(), 4000);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async pollTick(): Promise<void> {
    await this.refreshLoadedJobs();
    const settled =
      this.jobs().length >= this.jobsTotal() &&
      !this.jobs().some((job) => NON_TERMINAL_JOB_STATUSES.includes(job.status));
    if (settled) {
      this.stopPolling();
    }
  }

  // ---- Records: on-demand per job ----

  isExpanded(jobId: string): boolean {
    return this.expandedJobIds().has(jobId);
  }

  recordsForJob(jobId: string): EditableRecord[] | undefined {
    return this.jobRecords()[jobId];
  }

  isLoadingRecords(jobId: string): boolean {
    return this.loadingRecordsForJob().has(jobId);
  }

  toggleJobRecords(job: JobResponse): void {
    const expanded = new Set(this.expandedJobIds());
    if (expanded.has(job.id)) {
      expanded.delete(job.id);
      this.expandedJobIds.set(expanded);
      return;
    }
    expanded.add(job.id);
    this.expandedJobIds.set(expanded);
    if (this.jobRecords()[job.id] === undefined) {
      void this.loadRecordsForJob(job.id);
    }
  }

  private async loadRecordsForJob(jobId: string): Promise<void> {
    const loading = new Set(this.loadingRecordsForJob());
    loading.add(jobId);
    this.loadingRecordsForJob.set(loading);
    try {
      const page = await this.api.listJobRecords(jobId);
      this.jobRecords.update((existing) => ({ ...existing, [jobId]: page.items }));
    } catch (error) {
      this.handleError(error);
    } finally {
      const stillLoading = new Set(this.loadingRecordsForJob());
      stillLoading.delete(jobId);
      this.loadingRecordsForJob.set(stillLoading);
    }
  }

  // ---- Batch-wide records review queue ----

  async onBatchRecordsFilterChanged(): Promise<void> {
    await this.loadBatchRecords(0);
  }

  batchRecordsHasNextPage(): boolean {
    return this.batchRecordsOffset() + this.batchRecordsPageSize < this.batchRecordsTotal();
  }

  batchRecordsRangeLabel(): string {
    if (this.batchRecordsTotal() === 0) {
      return '0 of 0';
    }
    const start = this.batchRecordsOffset() + 1;
    const end = Math.min(this.batchRecordsOffset() + this.batchRecordsPageSize, this.batchRecordsTotal());
    return `${start}–${end} of ${this.batchRecordsTotal()}`;
  }

  batchRecordsNextPage(): void {
    if (this.batchRecordsHasNextPage()) {
      void this.loadBatchRecords(this.batchRecordsOffset() + this.batchRecordsPageSize);
    }
  }

  batchRecordsPreviousPage(): void {
    if (this.batchRecordsOffset() > 0) {
      void this.loadBatchRecords(Math.max(0, this.batchRecordsOffset() - this.batchRecordsPageSize));
    }
  }

  batchRecordsSelectedCount(): number {
    return this.batchRecords().filter((r) => r.selected).length;
  }

  async bulkApproveBatchRecordsSelected(): Promise<void> {
    const selectedIds = this.batchRecords()
      .filter((r) => r.selected)
      .map((r) => r.id);
    if (selectedIds.length === 0) {
      return;
    }
    try {
      const result = await this.api.bulkApproveRecords(selectedIds);
      for (const updated of result.items) {
        this.replaceBatchRecord(updated);
      }
      this.toast.success(`Approved ${result.items.length} record(s).`);
    } catch (error) {
      this.handleError(error);
    }
  }

  private async loadBatchRecords(offset: number): Promise<void> {
    this.batchRecordsLoading.set(true);
    try {
      const page = await this.api.listRecords({
        batchId: this.batchId,
        status: this.batchRecordsStatusFilter === 'ALL' ? undefined : this.batchRecordsStatusFilter,
        limit: this.batchRecordsPageSize,
        offset,
      });
      this.batchRecords.set(page.items);
      this.batchRecordsTotal.set(page.total);
      this.batchRecordsOffset.set(offset);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.batchRecordsLoading.set(false);
    }
  }

  private replaceBatchRecord(updated: RecordResponse): void {
    this.batchRecords.update((existing) => existing.map((r) => (r.id === updated.id ? { ...updated } : r)));
  }

  // ---- Shared record actions (used by both the per-job panels and the
  // batch-wide review queue) ----

  startEdit(record: EditableRecord): void {
    record.editing = true;
    record.editValues = Object.fromEntries(
      Object.entries(record.field_values).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );
  }

  cancelEdit(record: EditableRecord): void {
    record.editing = false;
    record.editValues = undefined;
  }

  async saveEdit(jobId: string | null, record: EditableRecord): Promise<void> {
    if (!record.editValues) {
      return;
    }
    record.saving = true;
    try {
      const updated = await this.api.updateRecord(record.id, record.version, record.editValues, 'manual correction');
      this.applyUpdatedRecord(jobId, updated);
      this.toast.success('Correction saved.');
    } catch (error) {
      this.handleError(error);
    } finally {
      record.saving = false;
    }
  }

  async approve(jobId: string | null, record: EditableRecord): Promise<void> {
    try {
      const updated = await this.api.approveRecord(record.id, record.version);
      this.applyUpdatedRecord(jobId, updated);
    } catch (error) {
      this.handleError(error);
    }
  }

  async reject(jobId: string | null, record: EditableRecord): Promise<void> {
    try {
      const updated = await this.api.rejectRecord(record.id, record.version);
      this.applyUpdatedRecord(jobId, updated);
    } catch (error) {
      this.handleError(error);
    }
  }

  async bulkApproveSelected(jobId: string): Promise<void> {
    const records = this.jobRecords()[jobId] ?? [];
    const selectedIds = records.filter((r) => r.selected).map((r) => r.id);
    if (selectedIds.length === 0) {
      return;
    }
    try {
      const result = await this.api.bulkApproveRecords(selectedIds);
      for (const updated of result.items) {
        this.replaceRecord(jobId, updated);
      }
      this.toast.success(`Approved ${result.items.length} record(s).`);
    } catch (error) {
      this.handleError(error);
    }
  }

  selectedCount(jobId: string): number {
    return (this.jobRecords()[jobId] ?? []).filter((r) => r.selected).length;
  }

  fieldEntries(record: EditableRecord): Array<[string, unknown]> {
    return Object.entries(record.field_values);
  }

  private applyUpdatedRecord(jobId: string | null, updated: RecordResponse): void {
    if (jobId !== null) {
      this.replaceRecord(jobId, updated);
    }
    if (this.batchRecords().some((r) => r.id === updated.id)) {
      this.replaceBatchRecord(updated);
    }
  }

  private replaceRecord(jobId: string, updated: RecordResponse): void {
    this.jobRecords.update((existing) => {
      const records = existing[jobId];
      if (!records) {
        return existing;
      }
      return {
        ...existing,
        [jobId]: records.map((r) => (r.id === updated.id ? { ...updated } : r)),
      };
    });
  }

  // ---- Export ----

  async generateExport(): Promise<void> {
    this.exporting.set(true);
    try {
      let created = await this.api.createExport(this.batchId, this.exportFormat, true);
      while (created.status === 'PENDING' || created.status === 'PROCESSING') {
        await this.sleep(1000);
        created = await this.api.getExport(created.id);
      }
      await this.refreshExports();
      if (created.error_message) {
        this.toast.info(created.error_message);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.exporting.set(false);
    }
  }

  downloadExportUrl(exportItem: ExportResponse): string {
    return this.api.downloadExportUrl(exportItem.id);
  }

  async deleteExport(exportItem: ExportResponse): Promise<void> {
    try {
      await this.api.deleteExport(exportItem.id);
      this.exports.update((existing) => existing.filter((e) => e.id !== exportItem.id));
    } catch (error) {
      this.handleError(error);
    }
  }

  statusClasses(status: string): string {
    switch (status) {
      case 'COMPLETED':
      case 'APPROVED':
        return 'bg-emerald-100 text-emerald-700';
      case 'FAILED':
      case 'REJECTED':
        return 'bg-red-100 text-red-700';
      case 'PROCESSING':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  private async loadAll(): Promise<void> {
    try {
      this.batch.set(await this.api.getBatch(this.batchId));
      await this.loadJobs();
      await this.loadBatchRecords(0);
      await this.refreshExports();
    } catch (error) {
      this.handleError(error);
    }
  }

  private async refreshExports(): Promise<void> {
    const page = await this.api.listExports({ limit: 50 });
    this.exports.set(page.items.filter((e) => e.batch_id === this.batchId));
  }

  private handleError(error: unknown): void {
    console.error(error);
    this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
