import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { ToastContainerComponent } from './components/toast/toast-container.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly currentUrl = toSignal(
    inject(Router).events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: inject(Router).url },
  );

  /** The sidebar shell is for signed-in pages only -- never on /login, even
   * when a still-valid token is sitting in storage. */
  protected readonly showShell = computed(
    () => this.auth.isAuthenticated() && !this.currentUrl().startsWith('/login'),
  );

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
