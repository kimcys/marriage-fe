# MarriageFe

Staff web UI for the Marriage OCR system: create batches, submit OneDrive share links, review and correct extracted
records, and export CSV/XLSX. Built with Angular 22 and Tailwind CSS 4; it talks to the FastAPI backend in
[`marriage-be`](https://github.com/kimcys/marriage-be). See `AGENTS.md` for architecture and conventions and `DESIGN.md`
for the design tokens.

## Development

Requires Node 24.x. Start the backend first (API on `http://localhost:8000`), then:

```bash
npm install
npm start          # ng serve, http://localhost:4200
```

The API base URL comes from `src/environments/environment.ts` (dev) and `environment.prod.ts` (production build).

## Build and test

```bash
npm run build      # production build into dist/
npm test           # Vitest via ng test
npx prettier --check "src/**/*.{ts,html,css}"
```

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) 22.1.4; see the
[Angular CLI reference](https://angular.dev/tools/cli) for `ng generate` and other commands.
