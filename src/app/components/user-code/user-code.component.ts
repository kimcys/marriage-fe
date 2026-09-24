import { Component, ElementRef, HostListener, input, signal } from '@angular/core';

/** A user's display code (e.g. MOCR001) that shows their name in a tooltip
 * the moment it's hovered or focused -- the browser's own `title` tooltip
 * only appears after a hover delay and is easy to miss. Positioned `fixed`
 * against the viewport so a scrolling/overflow-hidden table never clips it. */
@Component({
  selector: 'app-user-code',
  template: `
    <span
      class="font-geist-mono"
      [class.cursor-help]="!!name()"
      [class.underline]="!!name()"
      [class.decoration-dotted]="!!name()"
      [class.underline-offset-4]="!!name()"
      [attr.tabindex]="name() ? 0 : null"
      [attr.aria-label]="name() ? code() + ', ' + name() : null"
      >{{ code() ?? '—' }}</span
    >
    @if (tooltip(); as t) {
      <span
        role="tooltip"
        class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-buttons bg-ink px-2.5 py-1 font-sans text-caption font-medium text-surface-alt shadow-card"
        [style.left.px]="t.x"
        [style.top.px]="t.y"
        >{{ name() }}</span
      >
    }
  `,
})
export class UserCodeComponent {
  readonly code = input<string | null | undefined>(null);
  readonly name = input<string | null | undefined>(null);

  protected readonly tooltip = signal<{ x: number; y: number } | null>(null);

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  @HostListener('mouseenter')
  @HostListener('focusin')
  show(): void {
    if (!this.name()) {
      return;
    }
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.tooltip.set({ x: rect.left + rect.width / 2, y: rect.top - 6 });
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  @HostListener('window:scroll')
  hide(): void {
    this.tooltip.set(null);
  }
}
