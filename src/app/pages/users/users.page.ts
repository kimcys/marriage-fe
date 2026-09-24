import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiClientError } from '../../core/api-error';
import { ApiService, Role, UserSummary } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

const MIN_PASSWORD_LENGTH = 8;

/** The two roles, as this page names them. REVIEWER is what the API calls
 * a regular (non-admin) user. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  REVIEWER: 'User',
};

/** Admin-only account management: add people, rename them, switch between
 * Admin and User, disable/enable, and reset passwords. Every change lands in
 * the activity log. Accounts are disabled rather than deleted so they stay
 * attributed on everything they did. */
@Component({
  selector: 'app-users',
  imports: [FormsModule, DatePipe],
  templateUrl: './users.page.html',
})
export class UsersPage implements OnInit {
  protected readonly users = signal<UserSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly showAddForm = signal(false);
  protected readonly roleOptions = Object.entries(ROLE_LABELS) as [Role, string][];
  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  protected newName = '';
  protected newEmail = '';
  protected newRole: Role = 'REVIEWER';
  protected newPassword = '';

  protected editName = '';
  protected editRole: Role = 'REVIEWER';
  protected editPassword = '';

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  roleLabel(role: Role): string {
    return ROLE_LABELS[role] ?? role;
  }

  isSelf(user: UserSummary): boolean {
    return user.id === this.auth.currentUser()?.sub;
  }

  canCreate(): boolean {
    return (
      !!this.newName.trim() &&
      this.newEmail.includes('@') &&
      this.newPassword.length >= MIN_PASSWORD_LENGTH &&
      !this.saving()
    );
  }

  toggleAddForm(): void {
    this.showAddForm.update((open) => !open);
  }

  async createUser(): Promise<void> {
    if (!this.canCreate()) {
      return;
    }
    await this.run(async () => {
      const user = await this.api.createUser({
        name: this.newName.trim(),
        email: this.newEmail.trim(),
        role: this.newRole,
        password: this.newPassword,
      });
      this.users.update((users) => [...users, user]);
      this.newName = '';
      this.newEmail = '';
      this.newRole = 'REVIEWER';
      this.newPassword = '';
      this.showAddForm.set(false);
      this.toast.success(`Added ${user.code} · ${user.name}. Share the password with them directly.`);
    });
  }

  startEdit(user: UserSummary): void {
    if (this.editingId() === user.id) {
      this.editingId.set(null);
      return;
    }
    this.editingId.set(user.id);
    this.editName = user.name ?? '';
    this.editRole = user.role;
    this.editPassword = '';
  }

  async saveEdit(user: UserSummary): Promise<void> {
    const changes: { name?: string; role?: Role } = {};
    if (this.editName.trim() && this.editName.trim() !== (user.name ?? '')) {
      changes.name = this.editName.trim();
    }
    if (this.editRole !== user.role) {
      changes.role = this.editRole;
    }
    if (Object.keys(changes).length === 0) {
      this.editingId.set(null);
      return;
    }
    await this.run(async () => {
      this.replace(await this.api.updateUser(user.id, changes));
      this.editingId.set(null);
      this.toast.success(`Saved ${user.code}.`);
    });
  }

  async resetPassword(user: UserSummary): Promise<void> {
    if (this.editPassword.length < MIN_PASSWORD_LENGTH) {
      return;
    }
    await this.run(async () => {
      await this.api.resetUserPassword(user.id, this.editPassword);
      this.editPassword = '';
      this.toast.success(`New password set for ${user.code}. Share it with them directly.`);
    });
  }

  async toggleActive(user: UserSummary): Promise<void> {
    const disabling = user.is_active;
    if (
      disabling &&
      !confirm(`Disable ${user.code} · ${user.name ?? user.email}? They will be logged out and can't log in until re-enabled.`)
    ) {
      return;
    }
    await this.run(async () => {
      this.replace(await this.api.updateUser(user.id, { is_active: !disabling }));
      this.toast.success(`${disabling ? 'Disabled' : 'Enabled'} ${user.code}.`);
    });
  }

  private replace(updated: UserSummary): void {
    this.users.update((users) => users.map((u) => (u.id === updated.id ? updated : u)));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.users.set(await this.api.listUsers());
    } catch (error) {
      console.error(error);
      this.toast.error(error instanceof ApiClientError ? error.friendlyMessage() : 'Something went wrong.');
    } finally {
      this.loading.set(false);
    }
  }
}
