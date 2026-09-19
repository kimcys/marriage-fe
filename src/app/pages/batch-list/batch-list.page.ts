import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import { KNOWN_DAERAH, negeriForDaerah } from '../../core/geography';
import { ApiService, BatchResponse, BatchStatsResponse } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-batch-list',
  imports: [FormsModule, RouterLink],
  templateUrl: './batch-list.page.html',
})
export class BatchListPage implements OnInit {
  protected readonly batches = signal<BatchResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly loading = signal(false);
  protected readonly creating = signal(false);
  protected newBatchName = '';
  protected newBatchDescription = '';
  protected newBatchDaerah = '';
  protected newBatchNegeri = '';
  protected readonly knownDaerah = KNOWN_DAERAH;

  protected readonly stats = signal<BatchStatsResponse | null>(null);

  /** Only overwrites negeri when the typed daerah is one this app knows
   * about (see core/geography.ts) -- a daerah outside Selangor is still
   * free to type, it just doesn't auto-fill anything, and whatever the
   * user already typed into negeri is left alone. */
  onNewBatchDaerahChanged(): void {
    const negeri = negeriForDaerah(this.newBatchDaerah);
    if (negeri) {
      this.newBatchNegeri = negeri;
    }
  }

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    protected readonly auth: AuthService,
  ) {}

  ngOnInit(): void {
    void this.load(0);
    void this.loadStats();
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

  async loadStats(): Promise<void> {
    try {
      this.stats.set(await this.api.getBatchStats());
    } catch (error) {
      this.handleError(error);
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
      await this.api.createBatch(
        this.newBatchName.trim(),
        this.newBatchDescription.trim() || undefined,
        this.newBatchDaerah.trim() || undefined,
        this.newBatchNegeri.trim() || undefined,
      );
      this.newBatchName = '';
      this.newBatchDescription = '';
      this.newBatchDaerah = '';
      this.newBatchNegeri = '';
      await this.load(0);
      await this.loadStats();
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
      await this.loadStats();
      this.toast.success('Batch deleted.');
    } catch (error) {
      this.handleError(error);
    }
  }

  batchLocation(batch: BatchResponse): string {
    return [batch.daerah, batch.negeri].filter((value): value is string => !!value).join(', ');
  }

  /** Zero-pads single-digit stat values to match the design's Geist Mono
   * two-digit numerals ('06', '01', ...) -- purely cosmetic, values above
   * 99 are shown as-is. */
  pad(value: number): string {
    return value < 100 ? String(value).padStart(2, '0') : String(value);
  }

  statusClasses(status: BatchResponse['status']): string {
    switch (status) {
      case 'COMPLETED':
        return 'bg-success-bg text-success';
      case 'FAILED':
        return 'bg-error-bg text-error';
      case 'PROCESSING':
        return 'bg-info-bg text-info';
      case 'REVIEW_REQUIRED':
        return 'bg-warning-bg text-warning';
      default:
        return 'bg-neutral-bg text-neutral';
    }
  }

  private handleError(error: unknown): void {
    console.error(error);
    this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
  }
}
