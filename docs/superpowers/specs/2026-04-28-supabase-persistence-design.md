# Supabase Persistence Design

## Problem

The study system currently stores all progress in browser `localStorage`, so data can be lost when the browser profile is cleared, the device changes, or local storage is corrupted. The goal is to keep the current lightweight web app while saving all mutable study data to Supabase.

## Scope

Use a single-user local synchronization model:

- Keep the existing web/PWA interface and local Node server.
- Add server-side API endpoints for loading and saving study state.
- Store the Supabase PostgreSQL connection string only in a local `.env` file.
- Do not expose database credentials to browser code.
- Keep `localStorage` as a local fallback cache when the network or database is unavailable.

Out of scope for this phase:

- Multi-user accounts.
- Supabase Auth.
- Public deployment with browser-to-Supabase access.
- Git-tracked secrets or committed database credentials.

## Recommended Architecture

The app will continue to run with `npm start`. `server.js` will become a small HTTP server with two responsibilities:

1. Serve static assets such as `index.html`, `styles.css`, and `src/*.js`.
2. Expose JSON API endpoints used by the frontend:
   - `GET /api/state` loads the latest saved study state.
   - `PUT /api/state` saves the complete study state.
   - `GET /api/health` reports whether the database connection is configured and reachable.

The frontend will no longer treat `localStorage` as the source of truth. Instead:

1. On startup, initialize from `localStorage` immediately so the page stays fast.
2. Request `/api/state`.
3. If Supabase returns a saved state, replace the local state and render again.
4. After each user action, save to `localStorage` immediately and then save to Supabase through `PUT /api/state`.
5. Show a small sync status message so failures are visible instead of silent.

## Data Model

Use one versioned snapshot table for this single-user phase:

```sql
create table if not exists study_state (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
```

The fixed row id will be `default`. The `state` JSON will contain the same logical shape the frontend already uses:

- `cards`
- `plan`
- `wrongItems`
- `startedAt`

This keeps the first Supabase migration small and robust. The shape can later be normalized into separate tables if multi-user analytics, card history, or cross-device conflict resolution becomes necessary.

## Configuration

Add:

- `.env.example` with `DATABASE_URL=postgresql://...`
- `.env` ignored by git

Runtime behavior:

- If `DATABASE_URL` is missing, the app still runs with local-only storage and reports database status as unconfigured.
- If the database is configured but unavailable, API responses return explicit errors and the frontend keeps local data cached.

## Error Handling

The implementation must not swallow sync failures. It should:

- Return non-2xx API responses for database errors.
- Log server-side database errors with context but without printing credentials.
- Show frontend sync states such as `云端已同步`, `本地暂存`, and `云端同步失败`.
- Continue allowing study actions locally when cloud sync fails.

## Tests

Testing should preserve the current algorithm tests and add coverage for persistence boundaries:

- Existing spaced-repetition tests must still pass.
- State loading should prefer Supabase data when available.
- State saving should update local cache first and call the backend save API.
- API handlers should validate JSON shape enough to reject invalid payloads.

Database integration can use a mocked repository layer for automated tests. Manual verification can run against the provided Supabase database after `.env` is configured locally.

## Security Notes

The PostgreSQL connection string is a secret. It must only live in `.env` or runtime environment variables and must never be committed or embedded in browser JavaScript. Browser code should only call same-origin `/api/*` endpoints.

## Future Extension

If the system needs public access or multiple devices with login later, the next design should introduce Supabase Auth, Row Level Security, and per-user rows instead of the fixed `default` row.
