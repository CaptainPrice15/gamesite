# Arcade

A dark-themed browser arcade — six built-in games (**Snake, 2048, Breakout, Blocks, Pong,
Tic-Tac-Toe**) with solo play, local 2-player, online friend rooms, ranked matchmaking with ELO,
and global leaderboards. Installable PWA, $0/month hosting.

**Stack:** Vite + React 19 + TypeScript (strict) · Canvas 2D · Supabase (Postgres, anonymous
Auth, Realtime) · Vercel serverless functions · Vitest.

> **Verified 2026-10-03:** `format:check` ✅ · `lint` ✅ · `typecheck` ✅ · `test` ✅ (20 files,
> 208 tests) · `build` ✅ (158.7 KB gzip initial, < 200 KB budget) · no `service_role` in
> `dist/` ✅. All code (Phases 0–6) is done — **only your account/setup steps remain**, in the
> exact order below. Nothing works "live" until Steps 1–4 are finished.

## Next steps — setup checklist (in order)

> Order matters: Step 2 needs Step 1's keys, Step 4 needs Step 1's keys + Step 3's repo, and
> every live test in Step 5 needs Step 4's URL. Budget **~45 min** total.

### Step 1 — Create the Supabase project (~10 min)

- [ ] Sign up at [supabase.com](https://supabase.com) → **New project** (name it `arcade`, pick
      the region closest to your players — free tier is fine; choose a strong DB password and
      keep it somewhere safe).
- [ ] **Authentication → Sign In / Providers → Anonymous** → **enable** (this is the only auth
      method the app uses).
- [ ] **Realtime → Settings** → **uncheck "Allow public access"** — required: every room,
      queue and TTT topic is a *private* channel authorized by the `realtime.messages` RLS
      policies in the migration.
- [ ] **SQL Editor → New query** → paste the entire contents of
      `supabase/migrations/0001_init.sql` → **Run**. Must end with no errors and create:
      `profiles, scores, match_queue, matches, match_reports, ttt_games` + RPCs
      `ensure_profile, enqueue, dequeue, create_room, join_room, ttt_create, ttt_move,
      finish_match, leaderboard`.
- [ ] Sanity-check the migration ran (SQL Editor):

      select count(*) from pg_policies where schemaname = 'public';   -- expect ≥ 10
      select proname from pg_proc where proname = 'finish_match';      -- expect 1 row
      select rolanme from pg_roles where rolanme = 'service_role';    -- expect 1 row

- [ ] **Project Settings → API** → copy three values: **Project URL**, **anon public** key,
      **service_role** key (don't mix them up — anon is client-safe, service_role is secret).

### Step 2 — Run it locally (~5 min)

```powershell
Copy-Item .env.example .env.local    # macOS/Linux: cp .env.example .env.local
```

- [ ] Edit `.env.local` — replace the placeholders:
      `VITE_SUPABASE_URL=https://<project-ref>.supabase.co` and
      `VITE_SUPABASE_ANON_KEY=<anon public key>`.
      `.env.local` is gitignored — **never** put `SUPABASE_SERVICE_ROLE_KEY` there.
- [ ] `npm run dev` → open <http://localhost:5173>
- [ ] Accept the display-name prompt (this silently creates an anonymous session + profile).
- [ ] Play one solo Snake run to game over → the "Global rank / On the global leaderboard"
      line should appear under the result.
- [ ] Open **Leaderboard** → your Snake score is listed. If not, check the browser console for
      a 401/403/500 from `/api/submitScore` (503 = env vars still placeholders).
- [ ] Sanity-checks that need no app: **Settings** persists after reload, **theme toggle**
      persists, leaderboard shows the "offline/needs a connection" notice if you temporarily
      blank the env vars.

### Step 3 — Push to GitHub + CI (~5 min)

The repo has **zero commits**. Create an empty repo on GitHub (no README/.gitignore), then:

```powershell
git add -A
git commit -m "Game arcade: phases 0-6"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

- [ ] Watch the **Actions** tab: `lint → typecheck → test → build → service-key grep`, all
      green (the same 208 tests that pass locally).

### Step 4 — Deploy on Vercel (~10 min)

- [ ] [vercel.com](https://vercel.com) → **Add New → Project** → import your GitHub repo
      (framework preset auto-detects **Vite**; build command `npm run build`, output `dist`).
- [ ] **Settings → Environment Variables** — add:
  - `VITE_SUPABASE_URL` → Production **and** Preview
  - `VITE_SUPABASE_ANON_KEY` → Production **and** Preview
  - `SUPABASE_SERVICE_ROLE_KEY` → **Production only** (unlocks score writes + ELO updates)
  - optional later: `VITE_SENTRY_DSN`, `VITE_UMAMI_SRC`, `VITE_UMAMI_WEBSITE_ID`
- [ ] Back in Supabase → **Project Settings → API → Configuration → CORS**: add your Vercel
      domains (`https://<project>.vercel.app`, plus a custom domain if you have one) — needed
      for the browser to reach PostgREST/Realtime from production.
- [ ] **Deploy** → note the production URL. Functions `health`, `submitScore`, `reportMatch`
      are auto-detected from `api/` — verify `https://<url>/api/health` returns
      `{"ok":true,...}`.

### Step 5 — Live smoke test (~15 min)

- [ ] Production URL loads, anonymous sign-in works, name prompt appears on a fresh
      browser/incognito profile.
- [ ] Solo Snake run → score appears on the **global leaderboard**; the `scores` row has your
      `user_id` (a direct client-side `insert` into `scores` must be **rejected** by RLS).
- [ ] **Two browser windows** (or window + phone) → create a **friend room** → play a full
      TTT match and a full Pong match via the invite link; kill one tab mid-Pong → paused with
      a 90 s countdown → reopen → resumes.
- [ ] Two fresh profiles → **Find a random opponent (ranked)** → matched → finish → the
      `.elo-chip` in the nav and `/history` both show the rating change; run it again with a
      deliberately stale/differing report path if you can — a disagreement must **void** the
      match (no ELO change, `Void` row in `/history`).
- [ ] Lighthouse on the production URL: performance **> 90** (current bundle: 158.7 KB gzip).
- [ ] Real phone (touch d-pad, swipe for 2048/Snake, landscape hint on Pong) + Firefox or
      iOS Safari.

### Optional (after it all works)

- [ ] Vercel → **Settings → Firewall** → add a rate rule for `/api/*` (the app already has
      per-instance sliding-window limits: `submitScore` 10/min, `reportMatch` 30/min → 429 +
      `Retry-After`).
- [ ] Set `VITE_SENTRY_DSN` (production) → lazy error reporting; trigger a test error to see
      it land in Sentry.
- [ ] Set `VITE_UMAMI_SRC` + `VITE_UMAMI_WEBSITE_ID` → privacy-friendly analytics
      (page views + `game-open` events only).
- [ ] Supabase → **Database → Usage / Realtime → Usage** → set an alert; after a test session
      you should be far under 2M messages/month (~10.8k per 6-minute Pong match).

### Known gaps (not setup blockers)

- The homepage has no live **"players online"** counter yet (plan §9) — the
  `global:online` presence RLS policies already exist in the migration, only the client
  widget is missing.
- The global **"online features offline"** banner (plan §3) isn't wired — offline handling is
  currently per-page (Leaderboard / History show their own notices).

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

`.env.local` needs at minimum:

| Var | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` + Vercel | Supabase project URL (client-safe) |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` + Vercel | Anon key, RLS-protected (client-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Vercel only** | Never client-side, never committed, never `VITE_`-prefixed |

Without these the site still runs: solo games, settings and local bests work offline; online
features show a graceful "needs a connection" notice.

## Supabase setup (one-time)

1. Create a project (region nearest your players).
2. Authentication → Providers → enable **Anonymous** sign-ins.
3. Realtime → Settings → **disable "Allow public access"** (private channels require it).
4. Apply the schema: paste `supabase/migrations/0001_init.sql` into the SQL editor, or run
   `supabase db push` with the CLI.
5. Copy the project URL, anon key and service-role key.

The migration creates profiles, scores, match_queue, matches, ttt_games, match_reports, all RLS
policies, and the RPCs (`ensure_profile`, `enqueue`/`dequeue`, `create_room`/`join_room`,
`ttt_*`, `finish_match`, `leaderboard`). `finish_match` (the only thing that writes ELO) is
revoked from clients — only `/api/reportMatch` can call it with the service key.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` for app + node + api configs |
| `npm test` | Vitest unit/integration tests |
| `npm run build` | typecheck + production build |
| `npm run format` | Prettier write |

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build, then fails if the string
`service_role` appears in any shipped file under `dist/` (sourcemaps excluded — supabase-js
doc comments mention the key name).

## Deploy (Vercel)

1. Push the repo to GitHub, then import it in Vercel (framework preset: **Vite**).
2. Add env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (service key **only** on Vercel, never in preview branches you don't trust... it is scoped to
   production envs by default — keep it that way).
3. Deploy. Serverless functions live in `api/` (`health`, `submitScore`, `reportMatch`).

Optional observability env vars (client-safe, only loaded when set):

- `VITE_SENTRY_DSN` — lazy-loads Sentry error reporting in production builds.
- `VITE_UMAMI_SRC` + `VITE_UMAMI_WEBSITE_ID` — privacy-friendly Umami analytics.

## How multiplayer works

- **Friend rooms** — 6-char Crockford room codes, invite links (`/play/pong?room=XK4M9P`),
  presence-based ready-up, exponential reconnect (1s → 30s).
- **Matchmaking** — `enqueue` RPC matches players inside an expanding ELO window (±50 → ±300),
  race-free with `FOR UPDATE SKIP LOCKED`; the waiting player gets a private `user:{uid}`
  Realtime push (with polling as fallback). Ranked/casual queues never mix.
- **Tic-Tac-Toe online** — fully server-authoritative: moves are SQL RPCs, the board row is the
  truth, a trigger broadcasts changes to the private room topic. Cheat-proof.
- **Pong online** — host-client authority: host simulates at 60 Hz and broadcasts 12 Hz
  snapshots; the guest predicts its paddle and sends inputs on change. Disconnects pause with a
  90s grace, then forfeit.
- **Results** — both clients POST to `/api/reportMatch`; the first report is stored, the second
  is compared. Agreement → `finish_match` updates ELO (K=32). Disagreement or a report that
  arrives >60s late → match voided, no rating change. Tic-Tac-Toe winners are taken from the
  server row, not the clients.

## Project layout

```
src/core     fixed-timestep loop, input, audio (procedural SFX), rng, theme, settings
src/games    one folder per game: logic.ts (pure, tested) + engine.ts (canvas)
src/net      useRoom (friend rooms), useQueue (matchmaking), useTttNet, backoff, presence
src/lib      supabase client, auth/profile provider, score + match reporting, analytics
src/ui       GameHost, Lobby, ModeSelect, QueueSearch, Leaderboard, NavBar, ...
src/shared   pure logic shared by app + api: elo, match consensus, score rules, rate limit
api/         Vercel functions: health, submitScore, reportMatch
supabase/    migrations (schema + RLS + RPCs + realtime policies)
```

## Tests

Pure logic is separated from rendering, so tests are fast and broad: game logic per game, ELO
math, score validation, consensus/winner mapping, queue parsing, room backoff/presence, plus
integration tests that boot every registered game in jsdom (`src/test/`).

## Free-tier notes

Supabase free: 2M realtime messages/month, 100 events/s → roughly 3 concurrent Pong matches
(12 Hz snapshots × 2 recipients + inputs). Vercel Hobby is **non-commercial** — upgrade before
any ads or monetization. See `plan.md` §8 for the full budget and tuning levers.
