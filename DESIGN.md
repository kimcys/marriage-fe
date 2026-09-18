# Ui — Style Reference
> clinical blueprint on frosted paper

**Theme:** light

shadcn/ui is a monochromatic design-system workshop: pure white canvas, soft warm-gray surfaces, and large-radius cards floating on hairline borders. The interface is almost entirely achromatic — black text, white surfaces, gray secondary tones — with a single destructive red reserved for error states and nothing else. Typography leans on Geist's geometric neutrality with tight letter-spacing on display sizes, creating a quiet, code-adjacent feel that reads as developer infrastructure rather than consumer product.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas | `#f5f5f5` | `--color-canvas` | Page background, muted surface fills, secondary buttons |
| Paper | `#ffffff` | `--color-paper` | Card surfaces, popover backgrounds, primary button fills |
| Surface Alt | `#fafafa` | `--color-surface-alt` | Sidebar background, subtle card variant, input resting state |
| Ink | `#0a0a0a` | `--color-ink` | Primary text, headings, button labels, icon strokes |
| Ink Soft | `#171717` | `--color-ink-soft` | Filled button backgrounds, secondary text on light surfaces |
| Mid Gray | `#737373` | `--color-mid-gray` | Muted body text, placeholder text, helper labels, icon fills at rest |
| Hairline | `#e5e5e5` | `--color-hairline` | Borders, input outlines, card edges, badge outlines |
| Ember | `#e7000b` | `--color-ember` | Red decorative accent for icons, marks, and small graphic details. Use as a supporting accent, not as a status color |

## Tokens — Typography

### Geist — All interface text — body at 14px/400, headings ranging 24–48px/600, buttons at 13–14px/500. Geist's geometric letterforms and uniform stroke width create a developer-tool neutrality; weight 600 at 48px with -0.05em tracking produces tight, confident display headlines that feel engineered rather than editorial. · `--font-geist`
- **Substitute:** Inter
- **Weights:** 400, 500, 600
- **Sizes:** 12, 13, 14, 16, 18, 24, 30, 36, 48
- **Line height:** 1.10, 1.11, 1.20, 1.33, 1.43, 1.50, 1.56, 1.63, 2.00
- **Letter spacing:** -0.0500em at display (48px), -0.0250em at subheading (24–30px), 0.0500em at caption (12px uppercase). Tracking tightens aggressively at large sizes and loosens slightly at small uppercase labels.
- **OpenType features:** `"ss01" on, "cv11" on`
- **Role:** All interface text — body at 14px/400, headings ranging 24–48px/600, buttons at 13–14px/500. Geist's geometric letterforms and uniform stroke width create a developer-tool neutrality; weight 600 at 48px with -0.05em tracking produces tight, confident display headlines that feel engineered rather than editorial.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 12px | 1.33 | 0.6px | `--text-caption` |
| body | 14px | 1.43 | — | `--text-body` |
| body-lg | 16px | 1.5 | — | `--text-body-lg` |
| subheading | 18px | 1.56 | — | `--text-subheading` |
| heading-sm | 24px | 1.33 | -0.6px | `--text-heading-sm` |
| heading | 30px | 1.2 | -0.75px | `--text-heading` |
| heading-lg | 36px | 1.11 | -0.9px | `--text-heading-lg` |
| display | 48px | 1.1 | -2.4px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 48 | 48px | `--spacing-48` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 24px |
| small | 6px |
| badges | 18px |
| inputs | 18px |
| nested | 10px |
| buttons | 18px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| card | `0 0 0 1px rgba(23,23,23,0.05), 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` | `--shadow-card` |

### Layout

- **Page max-width:** 1280px
- **Section gap:** 24px
- **Card padding:** 20px
- **Element gap:** 8px

## Components

### Primary Filled Button
**Role:** High-emphasis action (Submit, Save, Create)

Background #0a0a0a, text #fafafa, border none, radius 18px, padding 0px 16px, font 14px Geist weight 500. Height ≈ 36–40px, hover darkens to #171717. The dark-on-light inversion is the only chromatic interaction in the system; the fully rounded radius (18px on a ~36px height) produces perfect pill geometry.

### Secondary Ghost Button
**Role:** Low-emphasis action (Cancel, Back)

Background #f5f5f5, text #0a0a0a, no border, radius 18px, padding 0px 12–16px, font 14px weight 500. Soft gray fill reads as a tonal sibling to the primary rather than a muted alternative.

### Outline Button
**Role:** Tertiary action with visible boundary

Background transparent, text #0a0a0a, border 1px solid #e5e5e5, radius 18px, padding 0px 10–12px. The hairline border defines the shape without weight — preferred when the button sits inside a card or alongside filled controls.

### Card
**Role:** Content container for blocks, previews, dashboard panels

Background #ffffff, radius 24px, border 1px solid #e5e5e5, shadow `--shadow-card`, padding 20px. The 1px hairline shadow stacks with a faint elevation layer — cards sit visually raised but remain flat and understated.

### Input Field
**Role:** Text entry, search, form controls

Background #f5f5f5 (resting), text #0a0a0a, border none at rest with 1px #e5e5e5 ring on focus, radius 18px, padding 8px 14px, font 14px weight 400.

### Badge — Solid (status)
**Role:** Batch/job/record status pill

Background/text pair from the status palette below, radius 18px, padding 2px 8px, font 12px weight 500. Status colors (success/warning/info/error/neutral) are additive to DESIGN.md — kept low-saturation and clearly secondary to the achromatic base.

### Sidebar Surface
**Role:** Left navigation panel

Background #fafafa, full-height, fixed width. Sits one tonal step off the canvas (#f5f5f5) so the navigation reads as a distinct layer without a divider line.

### Breadcrumb Trail
**Role:** Hierarchical path indicator

Inline text with `›` separators, font 14px weight 400, color #737373 for separators and #0a0a0a for the current segment.

### Stat Block
**Role:** Large numeric metric display, inside a Card

Label in 12px uppercase #737373, value in 36px weight 600 font-geist-mono #0a0a0a (or #e7000b for an attention metric) with -0.025em tracking, note in 14px #737373.

### Search Trigger
**Role:** Command palette / search input

Background #f5f5f5, text #737373, radius 18px, padding 8px 12px, with a keyboard shortcut indicator (⌘K) right-aligned.

### Destructive Action
**Role:** Delete, remove, revoke — error-adjacent interactions

Text or icon in #e7000b against the monochromatic palette. Reserved exclusively for destructive/error contexts, never decoration.

## Do's and Don'ts

### Do
- Use #0a0a0a on #ffffff for filled buttons — the dark inversion is the only primary action treatment.
- Maintain 18px radius on all buttons, inputs, and badges for perfect pill geometry; use 24px radius only on cards.
- Set display headlines at 30–48px/600 with tight negative tracking.
- Reserve #e7000b exclusively for destructive states; never use it for decoration, branding, or non-error emphasis.
- Stack card shadows as 1px hairline + 1px + 2px offset — the combined effect is a barely-perceptible elevation.
- Use #f5f5f5 for secondary surfaces and inputs; use #fafafa for sidebar and subtle card variants.

### Don't
- Do not introduce chromatic brand colors beyond #e7000b and the additive low-saturation status palette — the monochromatic palette is the system.
- Do not use border-radius values other than 18px (interactive) or 24px (containers); avoid square corners on any element.
- Do not skip the 1px hairline border on cards — the shadow alone does not define the card edge in this system.
- Do not set body text below 14px or above #737373 lightness — the type scale is deliberately compact.
- Do not apply gradients, colored shadows, or accent fills — every surface is a solid tone.
- Do not mix filled and outline buttons of the same size in a single row without visual rhythm.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Canvas | `#f5f5f5` | Page background, broadest layer |
| 1 | Sidebar | `#fafafa` | Navigation surface, one step lighter than canvas |
| 2 | Card | `#ffffff` | Primary content container, brightest surface |
| 3 | Input Fill | `#f5f5f5` | Resting input field, matches canvas tone for subtle differentiation |

## Elevation

- **Card:** `0 0 0 1px rgba(23,23,23,0.05), 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)`
- **Button (filled):** `none — relies on tonal contrast, not shadow`
- **Input (focus):** `1px solid #e5e5e5 ring, no offset shadow`

## Source

Imported from the claude.ai/design project "Marriage Register OCR" (`Marriage Register OCR.dc.html` + `uploads/DESIGN (1).md`), used as this app's replacement design system in place of the earlier Apple-style reference.
