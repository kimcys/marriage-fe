import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import { ApiService, BatchResponse } from '../../services/api.service';
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

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    void this.load(0);
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

  statusClasses(status: BatchResponse['status']): string {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-100 text-emerald-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'PROCESSING':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  private handleError(error: unknown): void {
    console.error(error);
    this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
  }
}
