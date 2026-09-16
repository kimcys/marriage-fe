import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, from, map, mergeMap, of, retry, throwError, timer } from 'rxjs';

import { ApiClientError } from '../core/api-error';

interface BackendErrorPayload {
  code: string;
  message: string;
  request_id: string;
  details?: string[] | null;
}

const RETRYABLE_STATUSES = new Set([0, 502, 503, 504]);
const MAX_RETRIES = 2;

/** A `responseType: 'blob'` request (file downloads) gets its error body
 * back as a Blob too, even for the backend's normal JSON error envelope --
 * it has to be read back to text and parsed before the payload can be
 * pulled out the usual way. */
function backendPayload$(error: HttpErrorResponse) {
  if (error.error instanceof Blob) {
    return from(error.error.text()).pipe(
      map((text) => {
        try {
          return (JSON.parse(text) as { error?: BackendErrorPayload }).error ?? null;
        } catch {
          return null;
        }
      }),
    );
  }
  return of((error.error as { error?: BackendErrorPayload } | null)?.error ?? null);
}

/**
 * Two responsibilities, applied to every HTTP call:
 *
 * 1. Retry-with-backoff for transient failures on GET requests only (network
 *    drop, gateway blip) -- never for POST/PATCH/DELETE, where a retry could
 *    double-submit a mutation the server already applied.
 * 2. Normalize every failure into an ApiClientError parsed from the
 *    backend's structured { error: { code, message, request_id } } envelope,
 *    so call sites get a consistent, friendly message (see
 *    ApiClientError.friendlyMessage()) instead of a raw HttpErrorResponse.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error: unknown, retryCount: number) => {
        const retryable =
          req.method === 'GET' && error instanceof HttpErrorResponse && RETRYABLE_STATUSES.has(error.status);
        if (!retryable) {
          throw error;
        }
        return timer(retryCount * 500);
      },
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        return backendPayload$(error).pipe(
          mergeMap((payload) =>
            throwError(
              () =>
                new ApiClientError(
                  error.status,
                  payload?.code ?? 'UNKNOWN_ERROR',
                  payload?.message ?? error.message,
                  payload?.request_id,
                  payload?.details ?? null,
                ),
            ),
          ),
        );
      }
      return throwError(() => error);
    }),
  );
};
