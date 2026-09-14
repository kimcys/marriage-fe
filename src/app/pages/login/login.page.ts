import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiClientError } from '../../core/api-error';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.page.html',
})
export class LoginPage {
  protected email = '';
  protected password = '';
  protected readonly loggingIn = signal(false);

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly toast: ToastService,
  ) {}

  async submit(): Promise<void> {
    if (!this.email.trim() || !this.password) {
      return;
    }
    this.loggingIn.set(true);
    try {
      await this.auth.login(this.email.trim(), this.password);
      await this.router.navigate(['/batches']);
    } catch (error) {
      this.password = '';
      this.toast.error(
        error instanceof ApiClientError && error.status === 401
          ? 'Incorrect email or password.'
          : error instanceof ApiClientError
            ? error.friendlyMessage()
            : 'Something went wrong.',
      );
    } finally {
      this.loggingIn.set(false);
    }
  }
}
