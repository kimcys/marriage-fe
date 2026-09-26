import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import { ActivityEntry, ApiService, UserSummary } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { UserCodeComponent } from '../../components/user-code/user-code.component';

const ACTIVITY_PAGE_SIZE = 50;

/** Every action the API records (see marriage-be activity/), in the order
 * the filter lists them. */
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  'batch.created': 'Added batch',
  'batch.updated': 'Edited batch',
  'batch.processing_stopped': 'Stopped processing',
  'batch.deleted': 'Deleted batch',
  'onedrive.link_submitted': 'Submitted OneDrive link',
  'onedrive.link_retried': 'Retried OneDrive link',
  'onedrive.skipped_reclassified': 'Reclassified skipped files',
  'onedrive.link_deleted': 'Deleted OneDrive link',
  'skipped_file.classified': 'Classified skipped file',
  'record.corrected': 'Corrected record',
  'record.approved': 'Approved record',
  'record.bulk_approved': 'Bulk-approved records',
  'record.deleted': 'Deleted record',
  'job.retried': 'Retried OCR job',
  'export.created': 'Created export',
  'export.downloaded': 'Downloaded export',
  'export.deleted': 'Deleted export',
  'user.created': 'Added user',
  'user.updated': 'Edited user',
  'user.disabled': 'Disabled user',
  'user.enabled': 'Enabled user',
  'user.password_reset': 'Reset password',
};

/** Admin-only audit trail: who did what, when -- filterable by person,
 * action and date range, newest first. */
@Component({
  selector: 'app-activity',
  imports: [FormsModule, DatePipe, RouterLink, UserCodeComponent],
  templateUrl: './activity.page.html',
})
export class ActivityPage implements OnInit {
  protected readonly entries = signal<ActivityEntry[]>([]);
  protected readonly users = signal<UserSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(false);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly pageSize = ACTIVITY_PAGE_SIZE;
  protected readonly actionOptions = Object.entries(ACTIVITY_ACTION_LABELS);

  protected userFilter = '';
  protected actionFilter = '';
  protected fromDate = '';
  protected toDate = '';

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    void this.load(0);
    void this.api
      .listUsers()
      .then((users) => this.users.set(users))
      .catch((error) => console.error(error));
  }

  async onFilterChanged(): Promise<void> {
    await this.load(0);
  }

  async clearFilters(): Promise<void> {
    this.userFilter = '';
    this.actionFilter = '';
    this.fromDate = '';
    this.toDate = '';
    await this.load(0);
  }

  hasFilters(): boolean {
    return !!(this.userFilter || this.actionFilter || this.fromDate || this.toDate);
  }

  actionLabel(action: string): string {
    return ACTIVITY_ACTION_LABELS[action] ?? action;
  }

  actionClasses(action: string): string {
    if (action.endsWith('.deleted') || action === 'user.disabled') {
      return 'bg-error-bg text-error';
    }
    if (action.startsWith('export.')) {
      return 'bg-warning-bg text-warning';
    }
    return 'bg-canvas text-ink-soft';
  }

  toggle(entry: ActivityEntry): void {
    this.expandedId.update((current) => (current === entry.id ? null : entry.id));
  }

  /** Field-by-field before/after for corrections and batch edits. */
  changes(entry: ActivityEntry): { field: string; before: string; after: string }[] {
    const raw = entry.details?.['changes'];
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    return Object.entries(raw as Record<string, [unknown, unknown]>).map(([field, [before, after]]) => ({
      field,
      before: this.display(before),
      after: this.display(after),
    }));
  }

  otherDetails(entry: ActivityEntry): { key: string; value: string }[] {
    return Object.entries(entry.details ?? {})
      .filter(([key, value]) => key !== 'changes' && key !== 'record_ids' && value !== null && value !== '')
      .map(([key, value]) => ({ key: key.replace(/_/g, ' '), value: this.display(value) }));
  }

  recordCount(entry: ActivityEntry): number {
    const ids = entry.details?.['record_ids'];
    return Array.isArray(ids) ? ids.length : 0;
  }

  hasDetails(entry: ActivityEntry): boolean {
    return this.changes(entry).length > 0 || this.otherDetails(entry).length > 0 || this.recordCount(entry) > 0;
  }

  /** A batch link only makes sense while the batch still exists. */
  batchLinkable(entry: ActivityEntry): boolean {
    return !!entry.batch_id && entry.action !== 'batch.deleted';
  }

  userName(entry: ActivityEntry): string {
    return entry.user_name ?? this.users().find((u) => u.id === entry.user_id)?.name ?? '';
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

  private display(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  /** Date inputs are local calendar days; "to" includes that whole day. */
  private dayBoundary(day: string, endOfDay: boolean): string | undefined {
    if (!day) {
      return undefined;
    }
    const date = new Date(`${day}T00:00:00`);
    if (endOfDay) {
      date.setDate(date.getDate() + 1);
    }
    return date.toISOString();
  }

  private async load(offset: number): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.listActivity({
        userId: this.userFilter || undefined,
        action: this.actionFilter || undefined,
        since: this.dayBoundary(this.fromDate, false),
        until: this.dayBoundary(this.toDate, true),
        limit: this.pageSize,
        offset,
      });
      this.entries.set(page.items);
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
