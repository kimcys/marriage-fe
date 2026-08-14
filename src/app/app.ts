import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { ToastContainerComponent } from './components/toast/toast-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
