# AGENTS.md — marriage-fe

Staff web UI for the Marriage OCR system: create batches, submit OneDrive share links, watch OCR progress, review and
correct extracted marriage/divorce/reconciliation records, export CSV/XLSX, and (admins) manage users and view activity.
Angular 22 single-page app talking to the FastAPI backend in `../marriage-be`. The workspace overview is `../AGENTS.md`.

The screens show real people's registry records. Never put real record data in code, tests, screenshots or commits.

---

## 1. Quick start

```bash
npm install                 # Node 24.x, npm 10.9 (see engines/packageManager in package.json)
npm start                   # ng serve -> http://localhost:4200, API at http://localhost:8000/api/v1
npm run build               # production build into dist/
npm run watch               # development build in watch mode
npm test                    # ng test (Vitest runner)
npx prettier --check "src/**/*.{ts,html,css}"
```

Run `../marriage-be` first (`uvicorn marriage_ocr_api.main:app --reload`, with Postgres up and a user created via
`python -m marriage_ocr_api.auth.cli create-user`). The backend's `CORS_ORIGINS` must include `http://localhost:4200`.

Stack: Angular 22 (standalone components, signals, lazy routes), TypeScript ~6.0, RxJS ~7.8, Angular CDK, Tailwind CSS 4
via `@tailwindcss/postcss` (`.postcssrc.json`), Prettier 3, Vitest through `@angular/build`. No UI component library;
components are hand-built from Tailwind utilities and the design tokens below.

## 2. Environments

`src/environments/environment.ts` (dev: `apiBaseUrl: 'http://localhost:8000/api/v1'`) and `environment.prod.ts`
(`https://api.lauktech.xyz/api/v1`), swapped in by the production `fileReplacements` entry in `angular.json`. Add new
config keys to both files. Don't hardcode URLs elsewhere; `ApiService` reads `environment.apiBaseUrl`.

## 3. Source layout

```
src/main.ts, index.html, styles.css      bootstrap, global Tailwind layer and design tokens
src/app/app.ts|html|css                  shell: sidebar navigation, router outlet, toast host
src/app/app.config.ts                    providers: router + HttpClient with interceptors [authInterceptor, errorInterceptor]
src/app/app.routes.ts                    lazy routes (below)
src/app/pages/<name>/<name>.page.ts|html login, batch-list, batch-detail (largest, ~850 lines), records, activity, users
src/app/components/                      records-table (shared table), toast, user-code
src/app/services/                        api.service.ts (every HTTP call + all API types), auth.service.ts, toast.service.ts
src/app/guards/                          auth.guard.ts, admin.guard.ts
src/app/interceptors/                    auth.interceptor.ts (Bearer token, 401 -> logout + /login), error.interceptor.ts
src/app/core/                            api-error.ts, file-download.ts, geography.ts, record-fields.ts
public/                                  static assets
docs/user-manual.html|pdf                end-user manual (Malay/English staff guide)
DESIGN.md                                design tokens and component specs (source of truth for visuals)
```

Routes: `/login`; `/batches` and `/batches/:id` and `/records` (auth required); `/activity` and `/users` (auth + admin).
`''` and unknown paths redirect to `/batches`. Pages are `*Page` classes loaded with `loadComponent`; keep new screens in
`pages/<name>/` with the `.page.ts` / `.page.html` naming and register them as lazy routes with the right guards.

## 4. How it works

- **Auth.** `POST /auth/login` returns `{access_token, token_type, role}`. `AuthService` stores the JWT in
  `localStorage` (`marriage_ocr_token`), decodes the payload client-side only to drive UI (email, role, expiry), and
  exposes signals (`token`, `currentUser`, `isAuthenticated`). Roles: `ADMIN`, `REVIEWER`. Never treat client-side role
  checks as security; the backend re-validates every request. Hide destructive/admin controls for reviewers.
- **HTTP.** Everything goes through `ApiService` (typed methods + exported types such as `BatchStatus`, `DocumentType`,
  `JobStatus`, `RecordStatus`, `RecordType`, `ExportStatus`, `OneDriveSubmissionStatus`, `Role`). Components never call
  `HttpClient` directly. `authInterceptor` attaches the token and handles 401; `errorInterceptor` normalizes errors
  (backend envelope `{error: {code, message, request_id, details}}`) into `ApiError` (`core/api-error.ts`), which pages
  surface via `ToastService`. Methods return Promises (`firstValueFrom`) in this codebase; follow that style.
- **Documents.** There is no file upload. A batch's documents come from OneDrive links the user pastes in
  `batch-detail`; the backend fetches, classifies and queues OCR jobs. The UI polls job/submission status. A document's
  type is decided entirely by the backend, so the UI only displays it via `DOCUMENT_TYPE_LABELS`.
- **Records.** `records-table` renders review rows; columns per record type come from `RECORD_TYPE_FIELDS` in
  `core/record-fields.ts`. Reviewers edit values (PATCH), approve/reject, bulk-approve, filter, and choose a sort
  (`newest` or `worst_first`). Records with validation issues or low OCR confidence appear as `PENDING_REVIEW`.
- **Exports.** Create an export (CSV/XLSX), poll status, download through `core/file-download.ts` (authenticated blob
  download; don't use plain `<a href>` for protected files).
- **Geography.** `core/geography.ts` holds negeri/daerah lists used when creating batches.

## 5. Keeping in sync with the backend and OCR repos

The contract is `../marriage-be/docs/frontend-integration.md` and `../marriage-be/artifacts/openapi.json` (regenerated by
`python scripts/export_openapi.py` in the backend). Be aware:

- `api.service.ts` types are maintained **by hand**. When the backend changes a response shape, enum, or endpoint, update
  the types and methods here in the same change.
- `core/record-fields.ts::RECORD_TYPE_FIELDS` mirrors the column lists in marriage-ocr's `exporter.py::XLSX_COLUMNS` and
  `typed/csv_writer.py::TYPED_CSV_COLUMNS` by hand; nothing enforces it. A new backend field silently stops showing up
  until it is added here. Nikah intentionally omits several raw/duplicate columns (see the comment in that file).
- `DocumentType` / `DOCUMENT_TYPE_LABELS` must cover every backend `DocumentType` value, including the legacy
  `TYPED_BORANG_4B`.

## 6. Design system (see DESIGN.md before touching visuals)

Light theme, "clinical blueprint on frosted paper": monochrome with hairline borders, one red accent. Tokens are exposed
as CSS variables / Tailwind theme values (`--color-canvas #f5f5f5`, `--color-paper #fff`, `--color-surface-alt #fafafa`,
`--color-ink #0a0a0a`, `--color-mid-gray #737373`, `--color-hairline #e5e5e5`, `--color-ember #e7000b`).
Type is Geist (Inter as substitute) at 12/13/14/16/18/24/30/36/48 px; base spacing unit 4 px; cards 24 px radius with
20 px padding and the card shadow; inputs, buttons and badges use 18 px radius; page max-width 1280 px. Status badges use a
low-saturation status palette (success, warning, info, error, neutral) documented in DESIGN.md. Red is for errors and
small accents only. Reuse existing patterns (buttons, cards, badges, stat blocks, sidebar) rather than inventing new
colors, radii or font sizes, and keep layouts usable at laptop widths (staff use desktops) without breaking narrow screens.

## 7. Conventions

- Formatting: Prettier (`printWidth: 100`, `singleQuote: true`, Angular parser for `.html`); `.editorconfig`: UTF-8, 2-space
  indent, final newline, single quotes in TS. Some existing lines exceed 100 columns; don't reformat unrelated code.
- Angular style: standalone components only (no NgModules), `inject()` for DI, signals/`computed` for state, `@if`/`@for`
  control flow in templates, `loadComponent` lazy routes, `providedIn: 'root'` services. Prefer `OnPush`-friendly,
  signal-based state in new code.
- TypeScript is strict (`tsconfig.json`); avoid `any`, type API payloads in `api.service.ts`.
- Comments explain why (decisions, backend quirks) in full sentences, as in the existing files. Don't add narration.
- User-facing copy targets registry staff: short, plain English; show backend error messages through the toast service
  rather than raw JSON. Keep terms consistent (Nikah, Cerai, Rujuk, batch, record, daerah, negeri).
- Accessibility basics: real `<button>`/`<a>`, labelled inputs, visible focus, status not conveyed by color alone.
- Don't commit `dist/`, `.angular/`, `node_modules/`, or `.env*`.

## 8. Testing and verification

There are currently no `*.spec.ts` files; Vitest is wired (`npm test`) but unused. For logic-heavy changes (`record-fields`,
`api-error`, guards, interceptors, filtering/sorting helpers) add `*.spec.ts` next to the file. Always run
`npm run build` (type-checks templates and TS) and the Prettier check before finishing, and for UI work start the dev
server and exercise the page in a browser (login, the affected flow, an error path, and a reviewer vs admin check where
relevant). Say so explicitly if you could not run the app.

## 9. Deployment

The production build (`dist/`) is static and calls `https://api.lauktech.xyz/api/v1`. The backend `CORS_ORIGINS` in
production must list the frontend's real origin. This repo has no CI workflow in the checkout; hosting is configured
outside the repo.
