/**
 * Normalized client-side representation of the backend's structured error
 * envelope ({ error: { code, message, request_id, details } }), produced by
 * the error interceptor for every failed HTTP call. Call sites can inspect
 * `.code`/`.isConflict`/`.isNetworkError` to react specifically (e.g. a 409
 * version conflict needs a "reload and retry" affordance, not just a raw
 * message), or just call `.friendlyMessage()` for a reasonable default.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: string[] | null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** Specifically a stale optimistic-concurrency version conflict (a
   * record/batch edited elsewhere since this client last read it) -- 409
   * alone isn't enough to mean that: SUBMISSION_NOT_FAILED,
   * JOB_NOT_COMPLETED, JOB_NOT_RETRYABLE, and SKIPPED_FILE_UNAVAILABLE are
   * also 409s, each with their own already-correct backend message that
   * must reach the user as-is, not get overwritten by the generic
   * "reload and try again" text below. */
  get isConflict(): boolean {
    return this.status === 409 && this.code === 'RECORD_CONFLICT';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  friendlyMessage(): string {
    if (this.isNetworkError) {
      return 'Could not reach the server. Check your connection and try again.';
    }
    if (this.isConflict) {
      return 'This record was changed by someone else in the meantime — reload the page and try again.';
    }
    if (this.isNotFound) {
      return 'This item no longer exists. It may have been deleted.';
    }
    return this.message || 'Something went wrong.';
  }
}
