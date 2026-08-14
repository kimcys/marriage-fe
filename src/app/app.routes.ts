import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'batches', pathMatch: 'full' },
  {
    path: 'batches',
    loadComponent: () => import('./pages/batch-list/batch-list.page').then((m) => m.BatchListPage),
  },
  {
    path: 'batches/:id',
    loadComponent: () => import('./pages/batch-detail/batch-detail.page').then((m) => m.BatchDetailPage),
  },
  { path: '**', redirectTo: 'batches' },
];
