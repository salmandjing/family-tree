# Family Tree App — Design Spec

**Date:** 2026-07-02
**Owner:** Salman (salmandjing@gmail.com)
**Primary user:** Salman's father (non-technical)
**Hosting:** GitHub Pages at djsalman.dev (path `/tree` or subdomain — Salman's choice at deploy time)

---

## 1. Goal

A clean, dead-simple web app for Salman's father to record the family's ancestry on his side (a large African family, 300+ people expected). Two non-negotiable requirements:

1. **Effortless to use** for a non-technical person, including on tablet/phone.
2. **Heavily redundant** — the data must never be lost, and failures must be loud, not silent.

## 2. Architecture Overview

```
┌────────────────────────────┐        ┌──────────────────────┐
│  Static SPA (GitHub Pages) │  HTTPS │  Cloudflare Worker    │
│  React + Vite + TS         │───────▶│  (backup service)     │
│  - family-chart renderer   │        │  - holds Drive secret │
│  - IndexedDB local store   │        │  - passphrase auth    │
│  - export/import JSON      │        │  - rate limiting      │
└────────────────────────────┘        └──────────┬───────────┘
                                                 │ Drive API
                                                 ▼
                                      ┌──────────────────────┐
                                      │  Salman's Google      │
                                      │  Drive (JSON backups) │
                                      └──────────────────────┘
```

- **Frontend:** static single-page app, React + Vite + TypeScript, deployed to GitHub Pages. No backend of its own.
- **Backup service:** one small Cloudflare Worker (free tier). It is the only component holding secrets (Google OAuth refresh token + client credentials, and the passphrase hash). Endpoints: `PUT /backup`, `GET /latest`, `GET /health`.
- **Storage of record:** the user's browser (IndexedDB) is the working copy; Salman's Google Drive holds the canonical backups.

### Component boundaries

| Unit | Does | Depends on |
|---|---|---|
| **Core data model** (`persons` + `unions` graph) | Owns all family data, validation, revisioning | nothing |
| **Renderer adapter** | Converts core model → family-chart's input format | core model |
| **Local store** | IndexedDB persistence, snapshots, soft-delete bin | core model |
| **Sync client** | Debounced backup to Worker, restore, conflict detection | local store, Worker API |
| **Serializer** | Core model + photo Blobs ⇄ single portable JSON (base64 photos) | core model |
| **UI shell** | Tree canvas, person card, search, status indicator | all of the above |

Each unit is independently testable; the renderer is swappable without touching data.

## 3. Data Model

A **graph, not a binary tree**: supports polygamy, remarriages/divorces, adopted/step/half relationships natively.

```jsonc
{
  "schemaVersion": 1,
  "revision": 142,                // monotonic, incremented every save
  "deviceId": "uuid",             // device that produced this revision
  "savedAt": "2026-07-02T14:00:00Z",
  "persons": [
    {
      "id": "uuid",
      "name": { "given": "", "family": "", "nicknames": [] },
      "sex": "M | F | unknown",
      "birth": { "date": "1950", "approx": true, "place": "" },
      "death": { "date": null, "approx": false, "place": "" },   // null = living
      "living": true,             // privacy flag for any future public sharing
      "notes": "",                // free-text stories — first-class, not buried
      "photos": ["photoId"],      // first entry = primary/face photo
      "deletedAt": null           // soft delete
    }
  ],
  "unions": [
    {
      "id": "uuid",
      "partners": ["personId", "personId"],
      "status": "married | divorced | separated | partner | unknown",
      "children": [
        { "personId": "uuid", "relation": "biological | adopted | step | foster | unknown" }
      ]
    }
  ],
  "photos": [
    { "id": "uuid", "personId": "uuid", "data": "base64...", "mime": "image/jpeg" }
  ]
}
```

Notes:
- A person may appear as a partner in **multiple unions** (polygamy, remarriage). Children are grouped by union; half-siblings fall out naturally.
- Dates are **strings with an `approx` flag** — "around 1950" is a valid, honored answer. Never force exact dates.
- `photos.data` is only populated in the **serialized/exported** form. At runtime, photos live as Blobs in IndexedDB (see §5).
- All updates are immutable-style: new objects, never in-place mutation. Every committed change bumps `revision`.

## 4. Redundancy Layers (the headline requirement)

1. **Live autosave → IndexedDB** on every committed edit. Survives refresh/crash; works fully offline.
2. **Local snapshot history** — keep the last **20 snapshots** locally, restorable from a "History" screen.
3. **Undo/redo** in-session, plus **soft-delete**: deleting a person moves them to a "Recently deleted" bin (30-day retention) — recoverable without knowing what a snapshot is.
4. **Auto-backup → Google Drive** via the Worker: debounced (**2 minutes after the last edit**, and on tab close via `sendBeacon` best-effort). Writes `family-tree-latest.json` and a timestamped copy `family-tree-2026-07-02T14-00.json`.
5. **Drive prune policy** (Worker-side): keep the **last 10** timestamped copies **+ one per calendar month** forever.
6. **Manual export/import** — one-click "Download JSON" and "Upload JSON" buttons, always available, no login needed.
7. *(Post-MVP)* GEDCOM export for permanent portability to any genealogy tool.

## 5. Photos

- On upload: client-side face-friendly resize + compression (`browser-image-compression`), max **512px, target ≤50KB JPEG**. One primary photo per person shown on the tree; additional photos allowed (same cap) on the person card.
- **Runtime storage:** photos are stored as **Blobs in IndexedDB**, referenced by ID — no base64 in the working data, no serialization jank.
- **Export/backup:** the serializer embeds photos as base64 into the single JSON, so one file = the whole tree. Expected total at 300 people ≈ 15–20 MB — acceptable for debounced upload.

## 6. Sync, Restore & Conflict Handling

- Every save records `revision` + `deviceId`.
- **On app open (online):** fetch Drive `latest` metadata.
  - Drive ahead of local → load Drive copy (this is also the **new-device restore flow**: passphrase → auto-restore).
  - Local ahead of Drive → back up.
  - **Diverged** (both changed since common revision) → plain-language dialog: *"This tree was edited on another device. Keep: [This device's version] [The other version] [Keep both copies]"*. "Keep both" saves the loser as a timestamped Drive copy and a local snapshot. **No silent merge, no silent overwrite.**
- **Offline:** app works fully; backup retries with backoff once online.

## 7. Access & Security

- **Shared passphrase**, entered once per device, stored in localStorage. It (a) unlocks the UI and (b) is sent as a bearer token to the Worker, which verifies against a stored **hash**.
- Frontend gate is cosmetic; **the Worker is the real enforcement** for reading/writing Drive.
- Worker **rate-limits** auth attempts (e.g., 10/min/IP) to prevent brute force.
- Google OAuth app: **`drive.file` scope only** (app can only touch files it created), consent screen set to **Production** mode — this avoids both Google verification review and the 7-day refresh-token expiry of Testing mode. Secrets live only as Worker environment secrets, never in the repo or the static site.
- No personal data ships in the static site bundle; a visitor without the passphrase sees only the lock screen.

## 8. Failure Visibility (no silent failures)

- Persistent **backup status indicator**: "✓ Backed up to Drive 2 min ago" → amber "Backing up…" → **red, plain words**: *"Backups stopped working — your changes are still saved on this device. Tell Salman."*
- Worker `GET /health` returns the timestamp of the last successful backup; Salman monitors it with a free uptime checker (e.g., pings it daily, alerts if stale > 7 days).
- Every error surfaced to the user is in plain language; detailed context is logged to the console / Worker logs.

## 9. Core UX (MVP)

- **Tree canvas:** pan/zoom (pinch on touch), built on **family-chart** (D3, MIT) via the renderer adapter. Handles 300+ people; **focus mode** collapses to a chosen person's branch.
- **Editing:** click/tap a person → card slides in → big buttons: *Add parent / Add spouse / Add child / Add photo / Edit / Delete (→ bin)*. Forms have few required fields (name only); everything else optional.
- **Search:** always-visible search box; typing a name jumps/centers the tree on that person.
- **Person card:** photo, names/nicknames, dates (with "approximate" toggle), places, relationship links, and a roomy **Stories/Notes** area.
- **Touch-first:** all targets ≥44px; tested on tablet and phone viewports as a first-class requirement.
- **Status bar:** backup indicator (§8) + History and Export/Import always reachable.

## 10. Tech Stack

| Concern | Choice |
|---|---|
| App | React + Vite + TypeScript |
| Tree rendering | [family-chart](https://github.com/donatso/family-chart) (D3, MIT) behind an adapter |
| Local storage | IndexedDB via `idb` |
| Photo compression | `browser-image-compression` |
| Backup service | Cloudflare Worker (free tier) + Google Drive API (`drive.file`) |
| Hosting | GitHub Pages (existing djsalman.dev setup) |
| Testing | Vitest (unit: model, serializer, sync logic), Playwright (E2E: add-person, backup, restore, conflict flows) |

## 11. Testing Strategy

- **Unit (80%+ on core units):** data model operations (add/link/soft-delete/undo), serializer round-trip (model → JSON → model, photos intact), conflict-detection logic, prune policy.
- **Integration:** Worker endpoints (auth, rate limit, backup write, latest read) against a mocked Drive API.
- **E2E (Playwright):** first-run passphrase + empty tree → add family → reload persists → export → wipe → import restores; simulated backup failure shows red state.

## 12. Out of Scope (MVP)

- Public read-only sharing of the tree (the `living` flag future-proofs this).
- GEDCOM import/export (post-MVP).
- Multi-user simultaneous editing / real-time collaboration (conflict dialog covers the realistic two-device case).
- Audio/voice notes (text stories only for now).

## 13. Build Phases (preview)

1. Core data model + local store + serializer (fully tested, no UI).
2. Tree UI: render + edit + search + photos.
3. Redundancy: snapshots, undo, soft-delete, export/import.
4. Worker + Drive backup + sync/restore/conflict flows.
5. Polish: touch, status states, passphrase gate, deploy to djsalman.dev.
