import { Injectable, computed, signal } from '@angular/core';

import { ApiService, Role } from './api.service';

const STORAGE_KEY = 'marriage_ocr_token';

interface DecodedToken {
  sub: string;
  email: string;
  role: Role;
  exp: number;
}

/** Manual base64url-decode of a JWT's payload segment -- no jwt-decode
 * dependency needed for something this small. Never trust this for
 * authorization (the backend re-validates the signature on every request);
 * it's only used here to drive what the UI shows (email/role, hiding
 * delete buttons for a reviewer). */
function decodeToken(token: string): DecodedToken | null {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as DecodedToken;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenSignal = signal<string | null>(this.readStoredToken());
  private readonly decodedSignal = computed(() => {
    const token = this.tokenSignal();
    return token ? decodeToken(token) : null;
  });

  readonly token = this.tokenSignal.asReadonly();
  readonly currentUser = this.decodedSignal;
  // Client-side expiry check is a UX nicety only (avoids showing "logged
  // in" for a moment with a token that's already lapsed after sitting open
  // for the full 7-day expiry) -- the backend re-validates the signature
  // and expiry on every request regardless, and the auth interceptor's
  // 401 handling is what actually enforces logout.
  readonly isAuthenticated = computed(() => {
    const decoded = this.decodedSignal();
    return decoded !== null && decoded.exp * 1000 > Date.now();
  });
  readonly isAdmin = computed(() => this.isAuthenticated() && this.decodedSignal()?.role === 'ADMIN');

  constructor(private readonly api: ApiService) {}

  async login(email: string, password: string): Promise<void> {
    const response = await this.api.login(email, password);
    this.setToken(response.access_token);
  }

  logout(): void {
    this.setToken(null);
  }

  authorizationHeader(): string | null {
    const token = this.tokenSignal();
    return token ? `Bearer ${token}` : null;
  }

  private setToken(token: string | null): void {
    this.tokenSignal.set(token);
    try {
      if (token) {
        localStorage.setItem(STORAGE_KEY, token);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Private browsing / blocked storage -- the in-memory signal above is
      // still authoritative for this tab, just won't survive a reload.
    }
  }

  private readStoredToken(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
