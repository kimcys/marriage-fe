import { Component } from '@angular/core';

import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  templateUrl: './toast-container.component.html',
})
export class ToastContainerComponent {
  constructor(protected readonly toastService: ToastService) {}

  classesFor(kind: string): string {
    switch (kind) {
      case 'error':
        return 'bg-red-600 text-white';
      case 'success':
        return 'bg-emerald-600 text-white';
      default:
        return 'bg-slate-900 text-white';
    }
  }
}
