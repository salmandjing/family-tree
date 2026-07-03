# Family Tree

A dead-simple, heavily-redundant web app for recording a large family's ancestry.
Built for a non-technical primary user, touch-first, and designed so **data is never
lost silently**. See the full design in [docs/specs/2026-07-02-family-tree-design.md](docs/specs/2026-07-02-family-tree-design.md).

- **Frontend:** React + Vite + TypeScript, static SPA on GitHub Pages.
- **Tree rendering:** [family-chart](https://github.com/donatso/family-chart) (D3, MIT) behind a swappable adapter.
- **Local storage of record:** IndexedDB (autosave, 20 snapshots, 30-day soft-delete bin).
- **Backup:** a Cloudflare Worker pushes JSON backups to the owner's Google Drive.

---

## How the redundancy works (the headline feature)

| Layer | What it protects against | Where |
|---|---|---|
| Autosave → IndexedDB | refresh/crash, offline | every edit |
| 20 local snapshots | "I broke something" | History screen |
| Undo/redo + soft-delete bin (30 days) | accidental deletes | in-app |
| Auto-backup → Google Drive | lost/broken device | debounced 2 min + on tab hide |
| Drive prune: last 10 + one/month forever | running out of history | Worker |
| Manual export/import JSON | everything else | one-click, no login |

Failures are **loud**: the status bar turns red with plain words, and the Worker's
`/health` endpoint exposes the last successful backup time for monitoring.

---

## Project layout

```
src/
  core/        # data model, immutable operations, serializer, validation (no UI, no deps)
  store/       # IndexedDB persistence, snapshots, photo blobs
  app/         # TreeService (app core), React context, useSync hook, config
  render/      # core model → family-chart adapter + the library wrapper
  sync/        # conflict logic, Worker API client, SyncClient, status model
  ui/          # React components (canvas, person card, panels, gate, dialogs)
worker/        # Cloudflare Worker: /backup /latest /health, Drive client, auth, rate limit
tests/         # Vitest unit + integration + a UI smoke test
```

Each unit is independently testable; the renderer is swappable without touching data.

---

## Develop

```bash
npm install
npm run dev            # local dev server
npm test               # run the full test suite (Vitest)
npm run test:coverage  # coverage (80%+ gate on core/store/sync/render/app/worker)
npm run typecheck
npm run build          # production build → dist/
```

The app runs **fully local-only** with no configuration — backup is optional.

---

## Deploy

Two independent pieces: the **static site** (GitHub Pages) and the **backup Worker**
(Cloudflare + Google Drive). You can ship the site alone and add backup later.

### 1. Static site → GitHub Pages

1. In the repo, **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_BASE` = `/tree/` (for `djsalman.dev/tree`) or `/` (for a subdomain).
   - `VITE_WORKER_URL` = your Worker URL (leave unset to ship local-only first).
3. Push to `main`. The [deploy workflow](.github/workflows/deploy.yml) tests, builds, and publishes.

> Serving under a subdomain like `tree.djsalman.dev`? Set `VITE_BASE=/` and point a
> CNAME at GitHub Pages.

### 2. Backup Worker → Cloudflare + Google Drive

**a. Google OAuth (one-time).** In Google Cloud Console:
- Create an OAuth client (type: *Web application*).
- Scope: **`drive.file` only** (the app can touch only files it creates).
- Set the consent screen to **Production** (avoids the 7-day refresh-token expiry of
  Testing mode and avoids Google's verification review for this narrow scope).
- Obtain a **refresh token** for the account whose Drive will hold backups (e.g. via
  the OAuth Playground with your client id/secret and the `drive.file` scope).

**b. Passphrase hash.** Choose a family password and hash it (the plain password is
never stored):

```bash
node scripts/passphrase-hash.mjs "the family password"
# → 64-char hex; this is PASSPHRASE_HASH
```

**c. Configure and deploy the Worker.**

```bash
cd worker
npm install
npx wrangler secret put PASSPHRASE_HASH        # paste the hash from step b
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
# edit wrangler.toml → set ALLOWED_ORIGIN to your site origin
npm run deploy
```

Then set `VITE_WORKER_URL` (repo variable) to the deployed Worker URL and re-run the
site deploy. Enter the family password once per device to unlock and enable backup.

**d. Monitor (recommended).** Point a free uptime checker at `GET /health`; alert if
`lastBackupAt` goes stale for more than ~7 days.

---

## Security notes

- Secrets (Google OAuth, passphrase hash) live **only** as Worker environment secrets —
  never in the repo or the static bundle.
- The frontend passphrase gate is cosmetic; the **Worker** is the real enforcement for
  reading/writing Drive, with constant-time passphrase checks and per-IP rate limiting.
- No personal data ships in the static bundle; a visitor without the passphrase sees
  only the lock screen.

---

## Testing

- **Unit:** data model ops, serializer round-trip (photos intact), conflict detection,
  prune policy, auth, rate limiter.
- **Integration:** Worker endpoints against a mocked Drive; SyncClient against a fake
  Worker with a real local store.
- **UI smoke:** first-run → add person → edit → add spouse (family-chart mocked).

```bash
npm test           # site + worker + sync
```
