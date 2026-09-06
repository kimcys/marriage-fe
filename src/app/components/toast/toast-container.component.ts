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
        return 'bg-error text-ice';
      case 'success':
        return 'bg-success text-ice';
      default:
        return 'bg-carbon text-ice';
    }
  }
}
