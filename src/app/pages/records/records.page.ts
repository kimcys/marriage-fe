import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { EditableRecord, RecordsTableComponent } from '../../components/records-table/records-table.component';
import { ApiClientError } from '../../core/api-error';
import { ApiService, RecordResponse, RecordStatus, RecordType } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

const RECORDS_PAGE_SIZE = 20;
const RECORDS_QUERY_DEBOUNCE_MS = 400;

type StatusFilter<T extends string> = T | 'ALL';

/** Everything extracted so far, across every batch -- independent of which
 * batch it came from, paginated and filterable (record type, review status,
 * free-text) the same way the batch-detail review queue is. Split out from
 * the batch dashboard into its own top-level page/route to match the
 * "Batches" / "Records" nav split in the redesign. */
@Component({
  selector: 'app-records',
  imports: [FormsModule, RecordsTableComponent],
  templateUrl: './records.page.html',
})
export class RecordsPage implements OnInit, OnDestroy {
  protected readonly records = signal<EditableRecord[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(false);
  protected readonly pageSize = RECORDS_PAGE_SIZE;
  protected typeFilter: StatusFilter<RecordType> = 'ALL';
  protected statusFilter: StatusFilter<RecordStatus> = 'ALL';
  protected query = '';

  private queryDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    void this.load(0);
  }

  ngOnDestroy(): void {
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
  }

  async onFilterChanged(): Promise<void> {
    await this.load(0);
  }

  /** Debounced: fires ~400ms after typing stops, rather than re-querying on
   * every keystroke. */
  onQueryChanged(): void {
    if (this.queryDebounceHandle !== null) {
      clearTimeout(this.queryDebounceHandle);
    }
    this.queryDebounceHandle = setTimeout(() => {
      this.queryDebounceHandle = null;
      void this.load(0);
    }, RECORDS_QUERY_DEBOUNCE_MS);
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

  onRecordUpdated(updated: RecordResponse): void {
    this.records.update((existing) => existing.map((r) => (r.id === updated.id ? { ...updated } : r)));
  }

  onRecordDeleted(recordId: string): void {
    this.records.update((existing) => existing.filter((r) => r.id !== recordId));
    this.total.update((total) => Math.max(0, total - 1));
  }

  private async load(offset: number): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.listRecords({
        status: this.statusFilter === 'ALL' ? undefined : this.statusFilter,
        recordType: this.typeFilter === 'ALL' ? undefined : this.typeFilter,
        q: this.query.trim() || undefined,
        limit: this.pageSize,
        offset,
      });
      this.records.set(page.items);
      this.total.set(page.total);
      this.offset.set(offset);
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      this.loading.set(false);
    }
  }
}
