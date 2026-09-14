import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';

/**
 * Runs before errorInterceptor (see app.config.ts's withInterceptors order):
 * attaches the stored JWT to every outgoing request, and on a 401 response
 * clears it and sends the viewer back to /login -- a lapsed/invalid token
 * should never just sit there producing a wall of failed requests.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const authHeader = auth.authorizationHeader();
  const authedReq = authHeader ? req.clone({ setHeaders: { Authorization: authHeader } }) : req;

  return next(authedReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
