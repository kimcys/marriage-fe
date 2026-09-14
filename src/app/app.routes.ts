import { Routes } from '@angular/router';

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
  { path: '**', redirectTo: 'batches' },
];
