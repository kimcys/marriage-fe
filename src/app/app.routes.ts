import { Routes } from '@angular/router';

import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'batches', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'batches',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/batch-list/batch-list.page').then((m) => m.BatchListPage),
  },
  {
    path: 'batches/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/batch-detail/batch-detail.page').then((m) => m.BatchDetailPage),
  },
  {
    path: 'records',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/records/records.page').then((m) => m.RecordsPage),
  },
  {
    path: 'activity',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./pages/activity/activity.page').then((m) => m.ActivityPage),
  },
  {
    path: 'users',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./pages/users/users.page').then((m) => m.UsersPage),
  },
  { path: '**', redirectTo: 'batches' },
];
