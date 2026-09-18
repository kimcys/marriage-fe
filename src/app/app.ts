import { Component, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ToastContainerComponent } from './components/toast/toast-container.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly displayName = computed(() => {
    const email = this.auth.currentUser()?.email;
    if (!email) {
      return '';
    }
    const local = email.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  });

  protected readonly initials = computed(() => {
    const name = this.displayName();
    return name ? name.slice(0, 2).toUpperCase() : '··';
  });

  constructor(
    protected readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  async logout(): Promise<void> {
    this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
