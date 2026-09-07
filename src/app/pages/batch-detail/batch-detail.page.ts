import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import {
  ApiService,
  BatchResponse,
  ExportFormat,
  ExportResponse,
  JobResponse,
  JobStatus,
  OneDriveSubmissionResponse,
  OneDriveSubmissionStatus,
  RecordResponse,
  RecordStatus,
} from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

interface EditableRecord extends RecordResponse {
  // Only one cell per record is ever open for editing at a time -- a
  // missing/flagged field's cell starts already "open" (see isEditingCell),
  // an already-filled cell opens on click.
  editingField?: string | null;
  editingValue?: string;
  savingField?: string | null;
}

type StatusFilter<T extends string> = T | 'ALL';

const JOBS_PAGE_SIZE = 50;
const JOBS_ROW_HEIGHT = 56;
const JOBS_LOAD_MORE_THRESHOLD = 15;
const RECORDS_PAGE_SIZE = 20;
const RECORDS_QUERY_DEBOUNCE_MS = 400;
const NON_TERMINAL_JOB_STATUSES: JobStatus[] = ['PENDING', 'PROCESSING'];
const NON_TERMINAL_SUBMISSION_STATUSES: OneDriveSubmissionStatus[] = ['PENDING', 'FETCHING'];

@Component({
  selector: 'app-batch-detail',
  imports: [FormsModule, RouterLink, ScrollingModule, NgTemplateOutlet],
  templateUrl: './batch-detail.page.html',
})
export class BatchDetailPage implements OnInit, OnDestroy {
  protected readonly jobsRowHeight = JOBS_ROW_HEIGHT;

  protected readonly batch = signal<BatchResponse | null>(null);

  // ---- OneDrive links: the only ingestion path. A link is fetched and every
  // file it resolves to auto-classified in the background -- this list is
  // that batch's submission history/status, polled (alongside jobs) only
  // while something is still PENDING/FETCHING. ----
  protected readonly oneDriveSubmissions = signal<OneDriveSubmissionResponse[]>([]);
  protected readonly submittingLink = signal(false);
  protected newOneDriveUrl = '';

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

  // ---- Batch-wide records review queue: paginated + filterable (status,
  // free-text over field values, and which OneDrive link a record came from),
  // using the records endpoint's batch_id/q/source_url filters so a reviewer
  // can work through "all PENDING_REVIEW records in this batch" without
  // manually opening each job's panel one at a time. ----
  protected readonly batchRecords = signal<EditableRecord[]>([]);
  protected readonly batchRecordsTotal = signal(0);
  protected readonly batchRecordsOffset = signal(0);
  protected readonly batchRecordsLoading = signal(false);
  protected batchRecordsStatusFilter: StatusFilter<RecordStatus> = 'PENDING_REVIEW';
  protected batchRecordsQuery = '';
  protected batchRecordsSourceUrl = '';
  protected readonly batchRecordsPageSize = RECORDS_PAGE_SIZE;

  protected readonly exports = signal<ExportResponse[]>([]);
  protected readonly exporting = signal(false);

  protected exportFormat: ExportFormat = 'XLSX';

  private batchId!: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private queryDebounceHandle: ReturnType<typeof setTimeout> | null = null;

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
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
  }

  // ---- OneDrive links ----

  async submitOneDriveLink(): Promise<void> {
    const url = this.newOneDriveUrl.trim();
    if (!url) {
      return;
    }
    this.submittingLink.set(true);
    try {
      await this.api.submitOneDriveLink(this.batchId, url);
      this.newOneDriveUrl = '';
      await this.loadOneDriveSubmissions();
      await this.loadJobs();
      this.startPolling();
      this.toast.success('Link submitted.');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.submittingLink.set(false);
    }
  }

  private async loadOneDriveSubmissions(): Promise<void> {
    const page = await this.api.listOneDriveLinks(this.batchId, 50, 0);
    this.oneDriveSubmissions.set(page.items);
  }

  /** A plain repeat submit of the same link is a no-op once it's FAILED --
   * the backend's URL-dedup returns the existing row unchanged. This is the
   * only way to actually re-run a failed link's fetch+classify. */
  async retryOneDriveSubmission(submission: OneDriveSubmissionResponse): Promise<void> {
    try {
      await this.api.retryOneDriveSubmission(this.batchId, submission.id);
      await this.loadOneDriveSubmissions();
      this.startPolling();
      this.toast.success('Retrying link.');
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Only re-fetches (and re-syncs jobs) while at least one submission is
   * still PENDING/FETCHING -- a settled batch stops touching this endpoint
   * on every poll tick, same principle as the jobs list below. */
  private async refreshSubmissionsIfPending(): Promise<void> {
    const pendingBefore = this.oneDriveSubmissions().filter((s) =>
      NON_TERMINAL_SUBMISSION_STATUSES.includes(s.status),
    ).length;
    if (pendingBefore === 0) {
      return;
    }
    await this.loadOneDriveSubmissions();
    const pendingAfter = this.oneDriveSubmissions().filter((s) =>
      NON_TERMINAL_SUBMISSION_STATUSES.includes(s.status),
    ).length;
    if (pendingAfter < pendingBefore) {
      // At least one submission just finished fetching+classifying -- any
      // routable files it found became new jobs, not yet in the loaded list.
      await this.loadJobs();
    }
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

  // ---- Adaptive polling: only keep polling while something loaded is still
  // PENDING/PROCESSING (a job) or PENDING/FETCHING (a OneDrive submission).
  // A batch that has fully settled stops polling entirely instead of
  // hitting the API forever at a fixed interval. ----

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
    await this.refreshSubmissionsIfPending();
    const jobsSettled =
      this.jobs().length >= this.jobsTotal() &&
      !this.jobs().some((job) => NON_TERMINAL_JOB_STATUSES.includes(job.status));
    const submissionsSettled = !this.oneDriveSubmissions().some((s) =>
      NON_TERMINAL_SUBMISSION_STATUSES.includes(s.status),
    );
    if (jobsSettled && submissionsSettled) {
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

  /** Debounced: fires ~400ms after the reviewer stops typing, rather than
   * re-querying on every keystroke. */
  onBatchRecordsQueryChanged(): void {
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
    this.queryDebounceHandle = setTimeout(() => {
      this.queryDebounceHandle = null;
      void this.loadBatchRecords(0);
    }, RECORDS_QUERY_DEBOUNCE_MS);
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

  private async loadBatchRecords(offset: number): Promise<void> {
    this.batchRecordsLoading.set(true);
    try {
      const page = await this.api.listRecords({
        batchId: this.batchId,
        status: this.batchRecordsStatusFilter === 'ALL' ? undefined : this.batchRecordsStatusFilter,
        q: this.batchRecordsQuery.trim() || undefined,
        sourceUrl: this.batchRecordsSourceUrl || undefined,
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

  // ---- Shared record table (used by both the per-job panels and the
  // batch-wide review queue): no separate edit/approve/reject workflow --
  // status is purely computed from missing_fields, and a reviewer adjusts a
  // value directly in its cell. A missing/flagged field's cell starts
  // already open as an input (highlighted); an already-filled cell opens on
  // click. ----

  /** Sorted union of every field key across the given records (field_values
   * keys plus any still-missing ones) -- a batch can mix Nikah/Cerai/Rujuk
   * records with different field sets on the same loaded page. */
  recordColumns(records: EditableRecord[]): string[] {
    const columns = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record.field_values)) {
        columns.add(key);
      }
      for (const key of record.missing_fields) {
        columns.add(key);
      }
    }
    return Array.from(columns).sort();
  }

  cellValue(record: EditableRecord, column: string): string {
    const value = record.field_values[column];
    return value == null ? '' : String(value);
  }

  isMissingCell(record: EditableRecord, column: string): boolean {
    return record.missing_fields.includes(column);
  }

  /** A missing/flagged field's cell is always an input; any other cell only
   * becomes one once explicitly clicked into (startCellEdit). */
  isEditingCell(record: EditableRecord, column: string): boolean {
    return this.isMissingCell(record, column) || record.editingField === column;
  }

  startCellEdit(record: EditableRecord, column: string): void {
    if (this.isEditingCell(record, column)) {
      return;
    }
    record.editingField = column;
    record.editingValue = this.cellValue(record, column);
  }

  /** The cell's live input value: whatever's been typed for the column
   * currently being edited, or the stored value otherwise (e.g. a
   * not-yet-touched missing-field cell, which starts blank). */
  cellInputValue(record: EditableRecord, column: string): string {
    return record.editingField === column ? (record.editingValue ?? '') : this.cellValue(record, column);
  }

  onCellChange(record: EditableRecord, column: string, value: string): void {
    record.editingField = column;
    record.editingValue = value;
  }

  async saveCell(jobId: string | null, record: EditableRecord, column: string): Promise<void> {
    if (record.editingField !== column || record.savingField === column) {
      // Nothing was actually typed for this cell (e.g. tabbed past an
      // untouched missing-field cell), or a save for it is already in flight.
      return;
    }
    const value = record.editingValue ?? '';
    if (!this.isMissingCell(record, column) && value === this.cellValue(record, column)) {
      // Unchanged -- close the cell without a redundant PATCH.
      record.editingField = null;
      return;
    }
    record.savingField = column;
    try {
      const updated = await this.api.updateRecord(record.id, record.version, { [column]: value }, 'manual correction');
      this.applyUpdatedRecord(jobId, updated);
      this.toast.success('Saved.');
    } catch (error) {
      this.handleError(error);
    } finally {
      record.savingField = null;
      record.editingField = null;
    }
  }

  recordStatusLabel(record: EditableRecord): string {
    return record.missing_fields.length > 0 ? 'Needs review' : 'Complete';
  }

  recordStatusClasses(record: EditableRecord): string {
    return record.missing_fields.length > 0 ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success';
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
      case 'FETCHED':
      case 'APPROVED':
        return 'bg-success-bg text-success';
      case 'FAILED':
      case 'REJECTED':
        return 'bg-error-bg text-error';
      case 'PROCESSING':
      case 'FETCHING':
        return 'bg-warning-bg text-warning';
      default:
        return 'bg-pebble text-carbon';
    }
  }

  private async loadAll(): Promise<void> {
    try {
      this.batch.set(await this.api.getBatch(this.batchId));
      await this.loadOneDriveSubmissions();
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
