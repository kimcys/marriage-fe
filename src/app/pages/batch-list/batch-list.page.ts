import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EditableRecord, RecordsTableComponent } from '../../components/records-table/records-table.component';
import { ApiClientError } from '../../core/api-error';
import { ApiService, BatchResponse, RecordResponse, RecordStatus, RecordType } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

const PAGE_SIZE = 20;
const RECORDS_PAGE_SIZE = 20;
const RECORDS_QUERY_DEBOUNCE_MS = 400;

type StatusFilter<T extends string> = T | 'ALL';

@Component({
  selector: 'app-batch-list',
  imports: [FormsModule, RouterLink, RecordsTableComponent],
  templateUrl: './batch-list.page.html',
})
export class BatchListPage implements OnInit, OnDestroy {
  protected readonly batches = signal<BatchResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly loading = signal(false);
  protected readonly creating = signal(false);
  protected newBatchName = '';
  protected newBatchDescription = '';

  // ---- All records across every batch: the landing page's "everything
  // that's been extracted so far" overview, independent of which batch it
  // came from -- paginated and filterable (record type, review status,
  // free-text) the same way the batch-detail review queue is. ----
  protected readonly records = signal<EditableRecord[]>([]);
  protected readonly recordsTotal = signal(0);
  protected readonly recordsOffset = signal(0);
  protected readonly recordsLoading = signal(false);
  protected readonly recordsPageSize = RECORDS_PAGE_SIZE;
  protected recordTypeFilter: StatusFilter<RecordType> = 'ALL';
  protected recordsStatusFilter: StatusFilter<RecordStatus> = 'ALL';
  protected recordsQuery = '';

  private queryDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    void this.load(0);
    void this.loadRecords(0);
  }

  ngOnDestroy(): void {
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
  }

  async load(offset: number): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.listBatches(this.pageSize, offset);
      this.batches.set(page.items);
      this.total.set(page.total);
      this.offset.set(offset);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.loading.set(false);
    }
  }

  nextPage(): void {
    if (this.hasNextPage()) {
      void this.load(this.offset() + this.pageSize);
    }
  }

  previousPage(): void {
    if (this.offset() > 0) {
      void this.load(Math.max(0, this.offset() - this.pageSize));
    }
  }

  hasNextPage(): boolean {
    return this.offset() + this.pageSize < this.total();
  }

  rangeLabel(): string {
    if (this.total() === 0) {
      return '0 of 0';
    }
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + this.pageSize, this.total());
    return `${start}–${end} of ${this.total()}`;
  }

  async createBatch(): Promise<void> {
    if (!this.newBatchName.trim()) {
      return;
    }
    this.creating.set(true);
    try {
      await this.api.createBatch(this.newBatchName.trim(), this.newBatchDescription.trim() || undefined);
      this.newBatchName = '';
      this.newBatchDescription = '';
      await this.load(0);
      this.toast.success('Batch created.');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.creating.set(false);
    }
  }

  async deleteBatch(batch: BatchResponse): Promise<void> {
    if (!confirm(`Delete "${batch.name}"? This removes every document, job, and record in it. This cannot be undone.`)) {
      return;
    }
    try {
      await this.api.deleteBatch(batch.id);
      await this.load(this.offset());
      await this.loadRecords(this.recordsOffset());
      this.toast.success('Batch deleted.');
    } catch (error) {
      this.handleError(error);
    }
  }

  statusClasses(status: BatchResponse['status']): string {
    switch (status) {
      case 'COMPLETED':
        return 'bg-success-bg text-success';
      case 'FAILED':
        return 'bg-error-bg text-error';
      case 'PROCESSING':
        return 'bg-warning-bg text-warning';
      default:
        return 'bg-pebble text-carbon';
    }
  }

  // ---- All records ----

  async onRecordsFilterChanged(): Promise<void> {
    await this.loadRecords(0);
  }

  /** Debounced: fires ~400ms after typing stops, rather than re-querying on
   * every keystroke. */
  onRecordsQueryChanged(): void {
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
    this.queryDebounceHandle = setTimeout(() => {
      this.queryDebounceHandle = null;
      void this.loadRecords(0);
    }, RECORDS_QUERY_DEBOUNCE_MS);
  }

  recordsHasNextPage(): boolean {
    return this.recordsOffset() + this.recordsPageSize < this.recordsTotal();
  }

  recordsRangeLabel(): string {
    if (this.recordsTotal() === 0) {
      return '0 of 0';
    }
    const start = this.recordsOffset() + 1;
    const end = Math.min(this.recordsOffset() + this.recordsPageSize, this.recordsTotal());
    return `${start}–${end} of ${this.recordsTotal()}`;
  }

  recordsNextPage(): void {
    if (this.recordsHasNextPage()) {
      void this.loadRecords(this.recordsOffset() + this.recordsPageSize);
    }
  }

  recordsPreviousPage(): void {
    if (this.recordsOffset() > 0) {
      void this.loadRecords(Math.max(0, this.recordsOffset() - this.recordsPageSize));
    }
  }

  onRecordUpdated(updated: RecordResponse): void {
    this.records.update((existing) => existing.map((r) => (r.id === updated.id ? { ...updated } : r)));
  }

  onRecordDeleted(recordId: string): void {
    this.records.update((existing) => existing.filter((r) => r.id !== recordId));
    this.recordsTotal.update((total) => Math.max(0, total - 1));
  }

  private async loadRecords(offset: number): Promise<void> {
    this.recordsLoading.set(true);
    try {
      const page = await this.api.listRecords({
        status: this.recordsStatusFilter === 'ALL' ? undefined : this.recordsStatusFilter,
        recordType: this.recordTypeFilter === 'ALL' ? undefined : this.recordTypeFilter,
        q: this.recordsQuery.trim() || undefined,
        limit: this.recordsPageSize,
        offset,
      });
      this.records.set(page.items);
      this.recordsTotal.set(page.total);
      this.recordsOffset.set(offset);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.recordsLoading.set(false);
    }
  }

  private handleError(error: unknown): void {
    console.error(error);
    this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
  }
}
