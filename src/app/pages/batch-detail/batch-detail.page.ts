import { ScrollingModule } from '@angular/cdk/scrolling';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { EditableRecord, RecordsTableComponent } from '../../components/records-table/records-table.component';
import { ApiClientError } from '../../core/api-error';
import { saveBlob, withoutExtension } from '../../core/file-download';
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
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

type StatusFilter<T extends string> = T | 'ALL';

const JOBS_PAGE_SIZE = 50;
const JOBS_ROW_HEIGHT = 56;
const JOBS_LOAD_MORE_THRESHOLD = 15;
const RECORDS_PAGE_SIZE = 20;
// Mirrors the backend's `limit` cap (Query(..., le=100) on every list
// endpoint) -- refreshLoadedJobs must never request more than this in one
// call, or the API rejects the request outright once more than 100 jobs
// have been incrementally loaded via scrolling.
const MAX_API_LIST_LIMIT = 100;
const RECORDS_QUERY_DEBOUNCE_MS = 400;
const NON_TERMINAL_JOB_STATUSES: JobStatus[] = ['PENDING', 'PROCESSING'];
const NON_TERMINAL_SUBMISSION_STATUSES: OneDriveSubmissionStatus[] = ['PENDING', 'FETCHING'];

@Component({
  selector: 'app-batch-detail',
  imports: [FormsModule, RouterLink, ScrollingModule, RecordsTableComponent],
  templateUrl: './batch-detail.page.html',
})
export class BatchDetailPage implements OnInit, OnDestroy {
  protected readonly jobsRowHeight = JOBS_ROW_HEIGHT;

  protected readonly batch = signal<BatchResponse | null>(null);
  protected readonly editingName = signal(false);
  protected readonly savingName = signal(false);
  protected editingNameValue = '';

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
  // Accordion-style: only one job's records panel is ever open at a time --
  // opening a different job's panel closes whichever one was open before.
  protected readonly expandedJobId = signal<string | null>(null);
  protected readonly jobRecords = signal<Record<string, EditableRecord[]>>({});
  protected readonly loadingRecordsForJob = signal<Set<string>>(new Set());
  protected readonly downloadingJobIds = signal<Set<string>>(new Set());

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
  protected readonly downloadingExportIds = signal<Set<string>>(new Set());

  protected exportFormat: ExportFormat = 'XLSX';

  private batchId!: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private queryDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly toast: ToastService,
    protected readonly auth: AuthService,
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

  async deleteBatch(): Promise<void> {
    const current = this.batch();
    if (!current) {
      return;
    }
    if (!confirm(`Delete "${current.name}"? This removes every document, job, and record in it. This cannot be undone.`)) {
      return;
    }
    try {
      await this.api.deleteBatch(this.batchId);
      this.toast.success('Batch deleted.');
      await this.router.navigate(['/batches']);
    } catch (error) {
      this.handleError(error);
    }
  }

  startEditName(): void {
    const current = this.batch();
    if (!current) {
      return;
    }
    this.editingNameValue = current.name;
    this.editingName.set(true);
  }

  cancelEditName(): void {
    this.editingName.set(false);
  }

  async saveName(): Promise<void> {
    const current = this.batch();
    const name = this.editingNameValue.trim();
    if (!current) {
      return;
    }
    if (!name || name === current.name) {
      this.editingName.set(false);
      return;
    }
    this.savingName.set(true);
    try {
      this.batch.set(await this.api.renameBatch(this.batchId, name));
      this.editingName.set(false);
      this.toast.success('Batch renamed.');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.savingName.set(false);
    }
  }

  /** Hard stop, not a resumable pause: a PENDING job is skipped entirely and
   * a PROCESSING job's OCR subprocess is killed, so a cancelled job has to
   * be retried from scratch afterward (via retryJob) rather than resumed
   * partway through. Cancellation is applied synchronously in the DB before
   * this returns, so one refresh is enough -- no extra polling needed. */
  async stopBatchProcessing(): Promise<void> {
    if (
      !confirm(
        'Stop all OCR processing for this batch? Any currently-running job will be cancelled and every pending job will be skipped. Cancelled jobs can be retried individually afterward.',
      )
    ) {
      return;
    }
    try {
      this.batch.set(await this.api.stopBatchProcessing(this.batchId));
      await this.refreshLoadedJobs();
      this.toast.success('Processing stopped.');
    } catch (error) {
      this.handleError(error);
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
      const { submission, isNew } = await this.api.submitOneDriveLink(this.batchId, url);
      this.newOneDriveUrl = '';
      await this.loadOneDriveSubmissions();
      await this.loadJobs();
      this.startPolling();
      // A duplicate submit (same URL already tracked) returns 200 and
      // triggers no new fetch -- say so explicitly, since the POST itself
      // succeeding either way gave no visible sign of that difference.
      if (isNew) {
        this.toast.success('Link submitted — processing in the background.');
      } else {
        this.toast.info(`This link is already tracked (status: ${submission.status}) — nothing new was started.`);
      }
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

  /** How many of this batch's submissions are still being fetched/classified
   * -- drives the "still processing" banner near the submit form, since the
   * POST itself returns almost instantly and gives no sense of the actual
   * (multi-minute, for many files) background work still running. */
  activeSubmissionsCount(): number {
    return this.oneDriveSubmissions().filter((s) => NON_TERMINAL_SUBMISSION_STATUSES.includes(s.status)).length;
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

  /** Deletes a link and everything it ingested -- documents, jobs, records
   * -- so the batch's job list and records queue can both change as a
   * result; refreshed here alongside the submissions list itself, same as
   * a completed submission's side effects are picked up in pollTick. */
  async deleteOneDriveSubmission(submission: OneDriveSubmissionResponse): Promise<void> {
    if (
      !confirm(
        `Delete this link? This removes every document, job, and record it produced. This cannot be undone.\n\n${submission.url}`,
      )
    ) {
      return;
    }
    try {
      await this.api.deleteOneDriveSubmission(this.batchId, submission.id);
      await this.loadOneDriveSubmissions();
      await this.loadJobs();
      await this.loadBatchRecords(0);
      this.batch.set(await this.api.getBatch(this.batchId));
      this.toast.success('Link deleted.');
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
   * the whole (potentially huge) job list on every poll tick. `loadedCount`
   * grows unboundedly as the reviewer scrolls (see loadMoreJobs), so once it
   * exceeds the backend's 100-item cap this must page through in chunks
   * rather than send one oversized request -- a single `limit: loadedCount`
   * call used to 400 outright ("query.limit: Input should be less than or
   * equal to 100") on any batch with more than 100 jobs loaded. */
  private async refreshLoadedJobs(): Promise<void> {
    const loadedCount = this.jobs().length;
    if (loadedCount === 0) {
      await this.loadJobs();
      return;
    }
    try {
      const offsets: number[] = [];
      for (let offset = 0; offset < loadedCount; offset += MAX_API_LIST_LIMIT) {
        offsets.push(offset);
      }
      const pages = await Promise.all(
        offsets.map((offset) =>
          this.api.listJobs({
            batchId: this.batchId,
            status: this.jobsFilterParam(),
            limit: Math.min(MAX_API_LIST_LIMIT, loadedCount - offset),
            offset,
          }),
        ),
      );
      const refreshedJobs = pages.flatMap((page) => page.items);
      this.jobs.set(refreshedJobs);
      this.jobsTotal.set(pages[pages.length - 1].total);

      // If a job just completed while its records panel was already open,
      // load its records automatically instead of leaving an empty panel.
      for (const job of refreshedJobs) {
        if (
          job.status === 'COMPLETED' &&
          this.expandedJobId() === job.id &&
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

  isDownloadingJob(jobId: string): boolean {
    return this.downloadingJobIds().has(jobId);
  }

  /** The download route needs a Bearer token a plain `<a href>` can't send,
   * so this fetches the file as a blob (through HttpClient, which the auth
   * interceptor attaches the token to) and saves it client-side instead. */
  async downloadJob(job: JobResponse): Promise<void> {
    if (this.isDownloadingJob(job.id)) {
      return;
    }
    this.downloadingJobIds.update((ids) => new Set(ids).add(job.id));
    try {
      const blob = await this.api.downloadJobFile(job.id);
      saveBlob(blob, `${withoutExtension(job.original_filename)}-result.xlsx`);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.downloadingJobIds.update((ids) => {
        const next = new Set(ids);
        next.delete(job.id);
        return next;
      });
    }
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
    return this.expandedJobId() === jobId;
  }

  recordsForJob(jobId: string): EditableRecord[] | undefined {
    return this.jobRecords()[jobId];
  }

  isLoadingRecords(jobId: string): boolean {
    return this.loadingRecordsForJob().has(jobId);
  }

  toggleJobRecords(job: JobResponse): void {
    if (this.expandedJobId() === job.id) {
      this.expandedJobId.set(null);
      return;
    }
    this.expandedJobId.set(job.id);
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

  /** RecordsTableComponent already updated its own bound array in place --
   * this only needs to sync the record into whichever OTHER list(s) might
   * also hold a separate object instance for the same row (a per-job panel
   * and the batch-wide queue are fetched independently, so the same DB row
   * can be two distinct JS objects if both happen to be open at once). */
  onRecordUpdated(updated: RecordResponse): void {
    this.jobRecords.update((existing) => {
      let changed = false;
      const next: Record<string, EditableRecord[]> = {};
      for (const [jobId, records] of Object.entries(existing)) {
        if (records.some((r) => r.id === updated.id)) {
          changed = true;
          next[jobId] = records.map((r) => (r.id === updated.id ? { ...updated } : r));
        } else {
          next[jobId] = records;
        }
      }
      return changed ? next : existing;
    });
    if (this.batchRecords().some((r) => r.id === updated.id)) {
      this.replaceBatchRecord(updated);
    }
  }

  onRecordDeleted(recordId: string): void {
    this.jobRecords.update((existing) => {
      const next: Record<string, EditableRecord[]> = {};
      for (const [jobId, records] of Object.entries(existing)) {
        next[jobId] = records.filter((r) => r.id !== recordId);
      }
      return next;
    });
    if (this.batchRecords().some((r) => r.id === recordId)) {
      this.batchRecords.update((existing) => existing.filter((r) => r.id !== recordId));
      this.batchRecordsTotal.update((total) => Math.max(0, total - 1));
    }
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

  isDownloadingExport(exportId: string): boolean {
    return this.downloadingExportIds().has(exportId);
  }

  /** Same Bearer-token requirement as downloadJob above. */
  async downloadExport(exportItem: ExportResponse): Promise<void> {
    if (this.isDownloadingExport(exportItem.id)) {
      return;
    }
    this.downloadingExportIds.update((ids) => new Set(ids).add(exportItem.id));
    try {
      const blob = await this.api.downloadExportFile(exportItem.id);
      saveBlob(blob, `export-${exportItem.batch_id}.${exportItem.format.toLowerCase()}`);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.downloadingExportIds.update((ids) => {
        const next = new Set(ids);
        next.delete(exportItem.id);
        return next;
      });
    }
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
      case 'REVIEW_REQUIRED':
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
