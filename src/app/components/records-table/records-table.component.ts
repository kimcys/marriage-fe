import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiClientError } from '../../core/api-error';
import { openBlob, saveBlob } from '../../core/file-download';
import { compareByFieldPriority, isKnownRecordType, RECORD_TYPE_FIELDS } from '../../core/record-fields';
import { ApiService, RecordResponse } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

export interface EditableRecord extends RecordResponse {
  // Only one cell per record is ever open for editing at a time -- a
  // missing/flagged field's cell starts already "open" (see isEditingCell),
  // an already-filled cell opens on click.
  editingField?: string | null;
  editingValue?: string;
  savingField?: string | null;
  openingSourceFile?: boolean;
  downloadingSourceFile?: boolean;
}

/** Shared record table: no separate edit/approve/reject workflow -- status
 * is purely computed from missing_fields, and a reviewer adjusts a value
 * directly in its cell. Used by both the batch-detail review queue and the
 * landing page's cross-batch records table. */
@Component({
  selector: 'app-records-table',
  imports: [FormsModule],
  templateUrl: './records-table.component.html',
})
export class RecordsTableComponent {
  @Input({ required: true }) records: EditableRecord[] = [];
  /** Fired after a cell save succeeds, so a parent holding this same record
   * in another list (e.g. batch-detail's per-job panel vs. its batch-wide
   * queue, fetched independently and so holding separate object instances
   * for the same row) can sync it too. This component's own bound array is
   * already updated in place -- callers with just one list can ignore it. */
  @Output() recordUpdated = new EventEmitter<RecordResponse>();
  /** Fired after a record is deleted -- the parent owns the array (this
   * component only received it as an Input), so it's the parent's job to
   * actually remove the row from its list/counts. */
  @Output() recordDeleted = new EventEmitter<string>();

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    protected readonly auth: AuthService,
  ) {}

  /** Sorted union of every column the loaded records can show -- a batch
   * can mix Nikah/Cerai/Rujuk records with different field sets on the same
   * loaded page. For each record whose type is recognised, this includes
   * every field RECORD_TYPE_FIELDS lists for that type (core AND optional),
   * not just whichever ones happen to be non-empty on these particular
   * records -- a genuinely blank/failed optional field (e.g. this batch's
   * documents never fill in "Isteri Ke") should still show as an empty
   * column, not vanish as if the backend never supported it. Every
   * record's own actual field_values/missing_fields keys are unioned in on
   * top regardless, so a record of an unrecognised type, or a real backend
   * field this list hasn't been updated for yet, is never hidden either. */
  recordColumns(): string[] {
    const columns = new Set<string>();
    for (const record of this.records) {
      const recordType = record.field_values['Record Type'];
      if (isKnownRecordType(recordType)) {
        for (const field of RECORD_TYPE_FIELDS[recordType]) {
          columns.add(field);
        }
      }
      for (const key of Object.keys(record.field_values)) {
        columns.add(key);
      }
      for (const key of record.missing_fields) {
        columns.add(key);
      }
    }
    return Array.from(columns).sort(compareByFieldPriority);
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

  async saveCell(record: EditableRecord, column: string): Promise<void> {
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
      Object.assign(record, updated);
      this.recordUpdated.emit(updated);
      this.toast.success('Saved.');
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      record.savingField = null;
      record.editingField = null;
    }
  }

  hasSourceFile(record: EditableRecord): boolean {
    return !!record.batch_id && !!record.document_id;
  }

  /** The download route needs a Bearer token a plain `<a href>` can't send,
   * so this fetches the file as a blob (through HttpClient, which the auth
   * interceptor attaches the token to) and opens it in a new tab instead. */
  async openSourceFile(record: EditableRecord): Promise<void> {
    if (record.openingSourceFile) {
      return;
    }
    record.openingSourceFile = true;
    try {
      const blob = await this.api.downloadDocumentFile(record.batch_id!, record.document_id!);
      openBlob(blob);
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      record.openingSourceFile = false;
    }
  }

  /** Same Bearer-token fetch as openSourceFile above, but saves the file to
   * disk instead of opening it in a new tab. */
  async downloadSourceFile(record: EditableRecord): Promise<void> {
    if (record.downloadingSourceFile) {
      return;
    }
    record.downloadingSourceFile = true;
    try {
      const blob = await this.api.downloadDocumentFile(record.batch_id!, record.document_id!);
      saveBlob(blob, record.original_filename ?? 'source-file');
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      record.downloadingSourceFile = false;
    }
  }

  async deleteRecord(record: EditableRecord): Promise<void> {
    if (!confirm('Delete this record? This cannot be undone.')) {
      return;
    }
    try {
      await this.api.deleteRecord(record.id);
      this.recordDeleted.emit(record.id);
      this.toast.success('Record deleted.');
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    }
  }

  /** Mirrors the backend's own review decision (records/repositories.py::
   * _initial_status_for) -- a record can need review either because a
   * field is still genuinely missing OR because the OCR extraction itself
   * flagged low confidence, so the visible label has to read record.status
   * directly rather than recompute from missing_fields alone (a
   * low-confidence record with every field auto-filled would otherwise show
   * as "Complete" here while the backend still has it as PENDING_REVIEW). */
  recordStatusLabel(record: EditableRecord): string {
    return record.status === 'PENDING_REVIEW' ? 'Needs review' : 'Complete';
  }

  recordStatusClasses(record: EditableRecord): string {
    return record.status === 'PENDING_REVIEW' ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success';
  }
}
