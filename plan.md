# Game Arcade — Detailed Build Plan

> **Goal:** A responsive, dark-themed website to play games online — 6 built-in browser games, local 2-player, online vs friend (room codes), online vs random (ELO matchmaking), global leaderboards. Hosted on **Vercel** with **Supabase Free** for realtime + database. Total cost: **$0/month**.

- Status: **paused — Phases 0-6 done (code side); only 🧑 account/deploy/manual-test steps remain**
- Last updated: 2026-10-02
- Owner: GOURAB
- Resume point: see §10.1 "Build Status & Resume Notes" — the 🧑 Supabase/ Vercel account steps (they unblock all live testing), then the per-phase live exit checks

---

## 1. Scope Decisions (confirmed)

| Aspect | Decision |
|---|---|
| Games (v1) | **Snake, Tetris-style blocks, 2048, Breakout, Tic-Tac-Toe, Pong** |
| Game type | Built-in browser games we own (no third-party embeds/licensing) |
| Multiplayer | **All modes:** local 2-player on one device + online vs friend (room codes) + online vs random (matchmaking + ELO) |
| Hosting | **Vercel** (frontend + serverless API) + **Supabase Free** (Postgres, Auth, Realtime) |
| Accounts available | GitHub, Vercel, Supabase |
| MVP features | Game library + categories, dark mode + responsive, multiplayer, sound + settings, **global leaderboards (added)** |
| Leaderboards | Global, persistent, per-game top scores + visible ELO for ranked matches |
| Auth | **Supabase anonymous sign-in** — zero friction, real user IDs, RLS-enforceable; email link can be added later |
| Tech stack | Vite + React + TypeScript, Canvas 2D rendering, Supabase JS v2, Vercel functions |

### Explicitly deferred (not in v1)
- Email/password or OAuth login (anonymous auth only; can link later)
- In-game chat (use emotes later; realtime messages cost quota)
- Accounts cross-device sync beyond anonymous profile claim
- Monetization (Vercel Hobby is non-commercial; upgrade before any ads)
- Replay-based anti-cheat / server referee for Pong

---

## 2. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript** | Fast dev/build, React for UI shell, tiny bundles with code-splitting |
| Game rendering | **Canvas 2D** (raw, not React state) | 60fps loops without re-render overhead |
| Backend API | **Vercel serverless functions** (`/api/*.ts`) | Same platform as site; validated score/match writes via service key |
| Database + Auth + Realtime | **Supabase Free** | Postgres (scores, ELO, queue) + anonymous auth + Broadcast/Presence — all free |
| Transport | **Supabase Realtime Broadcast** (private channels) | Solves Vercel's cross-instance WebSocket problem; free quota shown in §7 |
| Styling | Plain CSS with CSS variables (dark default) | No heavy UI framework; theme toggle = swap variables |
| Audio | Web Audio API, **procedurally generated SFX** | Zero asset licensing/weight; oscillator-based beeps |
| Tests | Vitest (game logic, ELO, utils) | Pure logic separated from rendering → easy to test |
| Lint/format | ESLint + Prettier + `tsc --noEmit` | CI gate on every push |
| E2E smoke | Playwright (optional, Phase 6) | Home → play → score path |
| CI/CD | GitHub Actions (lint/typecheck/test/build) + Vercel Git integration | Preview deploy per PR, production on `main` |

### Why not the alternatives
- **Pure Vercel WebSockets (2026 beta):** each connection is pinned to one function instance, **no cross-instance relay** (two players in a room usually land on different instances), and connections force-close at **300s on Hobby**. Real-time Pong would need a paid relay. Rejected for multiplayer.
- **Next.js:** unnecessary SSR, no WebSocket advantage for a canvas arcade. Vite is simpler.
- **Separate Node/Socket.io server (Render/Fly):** robust but a second hosting account with cold-start waits; user chose Vercel.
- **WebRTC/PeerJS P2P:** unlimited volume but NAT failures (~5-10%), more complexity, no server authority, still needs a signaling backend for matchmaking.

---

## 3. Architecture

```
┌─ Vercel (site + API) ─────────────────────┐   ┌─ Supabase Free ──────────────────────┐
│ Static frontend (Vite build → CDN, PWA)   │   │ Postgres                             │
│                                           │   │  profiles, scores, match_queue,      │
│ /api/submitScore  ─────────────────────────▶│  matches, ttt_games                   │
│   (service key; validates score caps,     │   │                                      │
│    rate limits, duration sanity)          │   │ Realtime Broadcast                   │
│ /api/reportMatch  ─────────────────────────▶│  private channels room:{code}         │
│   (consensus check; calls finish_match    │   │  + broadcast_changes trigger for TTT │
│    RPC to update ELO)                     │   │ Realtime Presence                    │
│                                           │   │  lobbies, ready-up, queue            │
└───────────────────────────────────────────┘   │ RLS on realtime.messages             │
                                                 │  → private channel authorization     │
        ▲ browser: canvas games + supabase-js    └──────────────────────────────────────┘
          (anon auth session, RLS-checked)
```

**Key principles**
1. **Server-authoritative where it's cheap** (Tic-Tac-Toe in SQL → cheat-proof ranked play).
2. **Host-client authority where a full server is too costly** (Pong), with consensus reporting for ranked results.
3. **Never trust the client for anything scored:** score inserts and ELO updates only happen server-side (service key / revoked RPC execute).
4. **Degrade gracefully:** if Supabase is unreachable, solo games + local scores still work; show an "online features offline" banner.

---

## 4. Repo Layout (single Vite project at repo root)

```
/├─ src/
│  ├─ core/            game loop (fixed timestep), input abstraction, audio, rng,
│  │                   storage (localStorage), theme, error boundary
│  ├─ games/
│  │  ├─ snake/        engine.ts + view + input maps
│  │  ├─ tetris/       engine.ts (hold, next, levels, line clear)
│  │  ├─ g2048/        engine.ts (merge logic — unit tested)
│  │  ├─ breakout/     engine.ts (paddle, bricks, power-ups)
│  │  ├─ ttt/          engine.ts + online adapter (RPC-driven)
│  │  └─ pong/          engine.ts + local 2P + online host/guest adapters
│  ├─ net/             supabaseClient.ts, useRoom.ts, useMatchmaking.ts,
│  │                   reconnect/backoff logic, presence helpers
│  ├─ ui/              GameCard, NavBar, CategoryFilter, SearchBox, Settings,
│  │                   Joypad (virtual d-pad), Leaderboard, Modal, Lobby, Banner
│  ├─ shared/          protocol types, constants, elo.ts, roomCode.ts
│  └─ main.tsx / App.tsx / routes
├─ api/                Vercel functions:
│                      submitScore.ts, reportMatch.ts
├─ supabase/
│  ├─ migrations/      0001_init.sql (schema, RLS, RPCs, triggers)
│  └─ config.toml      (local dev; CLI optional)
├─ .github/workflows/ci.yml
├─ vercel.json
├─ package.json
├─ .env.local          (git-ignored; Supabase keys for dev)
└─ plan.md             (this file)
```

### Environment variables
| Var | Where | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel + `.env.local` | Supabase project URL (client-safe) |
| `VITE_SUPABASE_ANON_KEY` | Vercel + `.env.local` | Supabase anon/publishable key (client-safe, RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Vercel only** (never client, never committed) | Service role key used by `/api/*` |

---

## 5. Game Specifications (v1)

Common engine contract — every game implements:

```ts
interface Game {
  init(ctx: CanvasRenderingContext2D, input: Input, audio: Audio, config: GameConfig): void;
  update(dt: number): void;        // fixed timestep, 60Hz accumulator
  render(ctx: CanvasRenderingContext2D): void;
  destroy(): void;
  // events: onScore(n), onGameOver(result), stateExport()/stateApply() (multiplayer)
}
```

- **Fixed timestep loop** (60Hz accumulator) → identical behavior across devices; required for deterministic networked play.
- **Seeded RNG** (mulberry32) → determinism for sync/replays.
- **Input abstraction:** semantic actions `UP/DOWN/LEFT/RIGHT/ACTION/PAUSE` mapped to keyboard, touch (swipe + virtual d-pad), Gamepad API.
- **Lazy-loaded** per route (`React.lazy`) → small initial bundle; **error boundary per game** so one crash can't kill the site.
- **Auto-pause** on `visibilitychange` (tab hidden) and on blur.
- **Card thumbnails** generated by rendering each game's attract screen to an offscreen canvas → data URL (no image assets).

| Game | Players | Modes | Notes |
|---|---|---|---|
| Snake | 1 | solo | Speed ramps with score; walls or wrap (setting); touch swipe |
| Tetris-style blocks | 1 | solo | 7-bag randomizer, hold, next queue, levels/speed, line-clear scoring |
| 2048 | 1 | solo | Swipe/arrow merge logic; best score persisted locally + global leaderboard |
| Breakout | 1 (+alt 2P battle later) | solo | Lives, power-ups (multiball, wide paddle), brick patterns by level |
| Tic-Tac-Toe | 2 | hotseat, online friend, online random | Online = **fully server-authoritative** (SQL RPC) |
| Pong | 2 | hotseat (W/S vs ↑/↓), online friend, online random | Online = host-client authority + prediction |

Controls legend + "How to play" modal **required for every game** (biggest retention lever for casual sites).

---

## 6. Data Model (Postgres + RLS)

All migrations live in `supabase/migrations/`.

### Tables
- **`profiles`** — `user_id uuid PK references auth.users`, `display_name text`, `elo int default 1200`, `is_anonymous bool`, `created_at timestamptz default now()`
  - RLS: SELECT own + public display names; UPDATE own.
  - Created automatically on first sign-in (client calls `ensure_profile(display_name)` RPC or a trigger on `auth.users`).
- **`scores`** — `id uuid PK`, `user_id uuid`, `game_id text`, `score int`, `duration_ms int`, `created_at timestamptz default now()`
  - RLS: **SELECT allowed to all authenticated**; **INSERT denied to clients** — only `api/submitScore` inserts with service key.
  - Index: `(game_id, score desc)` for leaderboard queries.
- **`match_queue`** — `user_id uuid`, `game_id text`, `elo int`, `joined_at timestamptz`
  - RLS: user can INSERT/DELETE own row; SELECT own only (matching happens inside RPC).
- **`matches`** — `id uuid PK`, `room_code text`, `game_id text`, `p1 uuid`, `p2 uuid`, `status text` (`pending|active|finished|void`), `result jsonb` (scores, winner), `p1_elo_before/p1_elo_after`, `p2_elo_before/p2_elo_after`, `created_at`, `finished_at`
  - RLS: players in the match can SELECT; INSERT via RPC (service only for finish).
- **`ttt_games`** — `id uuid PK`, `room_code text`, `p1 uuid`, `p2 uuid`, `board int[9]`, `turn uuid`, `status` (`waiting|active|finished`), `winner uuid|null`, `updated_at`
  - RLS: members only can SELECT.

### RPCs (SECURITY DEFINER)
- **`enqueue(game_id text) returns jsonb`**
  1. Deletes caller's stale rows and any queue rows older than 120s.
  2. Tries to pop the best opponent within an expanding ELO window: `abs(elo - my_elo) <= LEAST(300, 50 + floor(extract(epoch from now()-joined_at)) * 5)` using `FOR UPDATE SKIP LOCKED` (atomic, race-free).
  3. If found → insert a `matches` row (status `active`, random room code) → return `{matched:true, match_id, room_code, opponent}`.
  4. Else → insert caller into queue → return `{matched:false}`. Opponent learns via `postgres_changes` on `matches` where `p2 = me`.
- **`dequeue()`** — remove caller from queue (cancel search).
- **`ttt_create(room_code)` / `ttt_join(room_code)`** — atomic create/join with row lock; assigns p1/p2, sets `turn = p1`, status `active`.
- **`ttt_move(game_id uuid, cell int)`** — validates: caller is a member, game active, `turn = auth.uid()`, cell ∈ 0..8, cell empty. Applies move, detects win (8 lines) or draw, sets status/winner, advances turn.
  - A **trigger** on `ttt_games` after UPDATE/INSERT calls `realtime.broadcast_changes('topic:' || game_id, ...)` → both clients subscribed to that private topic receive the new board automatically.
- **`finish_match(match_id uuid, result jsonb)`** — computes ELO deltas (K=32), updates `matches` + both `profiles`. **`REVOKE EXECUTE ... FROM public, anon, authenticated`** — only `service_role` (i.e., `api/reportMatch`) can call it.
- **`leaderboard(game_id text, n int default 10)`** — top-N scores joined with display names.

### Realtime authorization (private channels)
- Dashboard: **Realtime → Settings → disable "Allow public access"** (required for private channels).
- RLS policy on `realtime.messages` (SELECT) for authenticated users: allow join/broadcast only if the caller is a member of the room the topic refers to, e.g.

```sql
create policy "room members can use room topics"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from matches m
    where (m.p1 = auth.uid() or m.p2 = auth.uid())
      and realtime.topic() = 'room:' || m.room_code
  )
);
```

- Client joins with `supabase.channel(topic, { config: { private: true } })` and must call `supabase.realtime.setAuth()` first.
- **Note:** Realtime Authorization is *Public Beta* → requires supabase-js **≥ v2.44.0**.
- **Fallback:** if beta issues bite, use public channels with high-entropy topics (e.g., `room:` + 128-bit random) instead.

---

## 7. Multiplayer Design

### 7.1 Rooms (online vs friend)
- 6-char room code, **Crockford base32** (excludes `I L O U 0 1`) → ~1B combinations.
- Invite link: `https://<site>/play/pong?room=XK4M9P` (auto-join on open) + copy button.
- Lobby via **Presence**: join → `track({name, ready:false})` → both ready → host starts.
- Presence discipline (free-tier limits: 20 ev/s, **5 track calls per client per 30s**): `track()` only on explicit actions (join, ready toggle, leave) — no heartbeat spam.

### 7.2 Tic-Tac-Toe (online) — fully server-authoritative
1. Player A creates/joins room → `ttt_create`/`ttt_join` RPC.
2. Both subscribe to private channel `topic:{ttt_game_id}` (fed by `broadcast_changes` trigger).
3. A move is a `ttt_move` RPC call → validated in SQL → board row updated → trigger broadcasts new state.
4. Win/draw → status set → clients show result → ranked result reported.
- **Result: hack-proof** (client cannot place a mark out of turn or alter the board).

### 7.3 Pong (online) — host-client authority + prediction
- **Host** (room creator): runs the fixed-step 60Hz sim, broadcasts a compact snapshot `{t, ball:{x,y,vx,vy}, paddles:[y1,y2], scores:[s1,s2]}` at **12 Hz** (JSON ≈ 80 bytes).
- **Guest:** sends `input {seq, dir}` events **only on key change** (~2-6/s); predicts its own paddle locally for instant response; reconciles against snapshots (ball state always taken from host).
- **Input sanitization:** clamp movement per tick to physically possible delta; drop absurd payloads.
- **Disconnect handling:** Presence drop → **90s pause grace** with "Opponent disconnected, reconnecting…" overlay → rejoin → host sends full snapshot → resume. Past grace → match `void` (or forfeit in ranked if opponent still present and player never returns).
- **Estimated latency:** ~100-200ms guest input→effect (input RTT + 83ms snapshot cadence). Acceptable for casual Pong; mitigated by local paddle prediction.
- **Ranked integrity:** on game over, **both** clients POST to `api/reportMatch`; the function stores the first report and compares the second:
  - Agree → call `finish_match` → ELO updates.
  - Disagree or timeout (60s) → match `void`, no ELO change.

### 7.4 Matchmaking (online vs random)
1. Client calls `enqueue(game_id)` RPC → matched instantly or queued.
2. Client subscribes (`postgres_changes`, filter `p2=eq.<me>`) for a `matches` insert → receives `match_id` + `room_code` → joins the room channel.
3. ELO: start **1200, K=32**; skill window expands with wait time (±50 → ±300 over ~60s); dodge (leave queue repeatedly) → short cooldown (tracked via recent `joined_at` rows).
4. Ranked vs casual toggle: casual matches don't change ELO (status field on match).

### 7.5 Solo score submission (leaderboards)
`api/submitScore` (Vercel function, service key):
1. Verify caller's JWT (`supabase.auth.getUser(token)`).
2. Validate: `score` within per-game plausible cap, `duration_ms >=` per-game minimum, payload schema.
3. Rate limit (~10/min per IP via Vercel Firewall rule + in-function sliding window).
4. Insert into `scores` (RLS denies direct client inserts).
5. Return new rank for a "You're #4!" toast.

---

## 8. Free-Tier Budget (honest limits + tuning levers)

| Resource | Free quota | Our usage / headroom |
|---|---|---|
| Realtime messages | **2M/month**, **100 ev/s** | Pong match ≈ 30 ev/s (12Hz snapshot×2 recipients + inputs) → **~3 concurrent matches**; ~10.8k msgs per 6-min match → **~150+ matches/month** within quota |
| Realtime connections | 200 peak | 2 per match — plenty |
| Broadcast payload | 256 KB | ~80 bytes/snapshot — trivial |
| Presence | 20 ev/s, 5 calls/client/30s | ready-up button only |
| Auth MAU | 50k | anonymous users count — fine |
| Postgres | 500 MB | scores are tiny |
| Vercel Hobby | static + functions free | **non-commercial use only** — OK now; upgrade before monetizing |

**Tuning levers if we approach limits:** drop snapshot rate to 10Hz/8Hz, delta-only payloads, casual Pong relay at 8Hz, batch emotes. **Upgrade path:** Supabase Pro $25/mo (5M msgs, 500 conns).

**Monitoring:** Supabase Dashboard → Usage, set alerts; Vercel Analytics.

---

## 9. UI/UX Requirements

- **Homepage:** hero + game-card grid, category filters (Puzzle / Arcade / 2-Player / Classic), search box, auto-generated thumbnails, "players online" count (cheap presence count).
- **Game page:** full-screen canvas, HUD (score/level/lives), pause button, controls legend, "How to play" modal, settings gear.
- **Multiplayer UI:** mode select (Local / Friend / Random) → lobby (codes, copy/invite, ready) → match → result screen with rating change.
- **Settings page:** master/music/SFX volume sliders, difficulty (Easy/Normal/Hard), control layout (left/right handed touch), reduced motion — all persisted to localStorage.
- **Leaderboards:** per-game top 10 with rank, display name, score, date; highlight own best.
- **Theme:** dark default, CSS variables, light/dark toggle persisted; respects `prefers-color-scheme`.
- **Responsive:** mobile-first; virtual d-pad for maze/paddle games; swipe for 2048/Snake; safe-area insets; landscape hint for Pong; tested at 360px width.
- **Accessibility:** keyboard-navigable menus, ARIA labels on controls, visible focus rings, WCAG AA contrast, `prefers-reduced-motion` respected, auto-pause on blur.
- **PWA:** manifest + service worker → installable; **solo games fully offline** (never cache API/SUPABASE requests; network-first for data).

---

## 10. Phased Roadmap

> Legend: ✅ done · 🔶 in progress · ⬜ not started · 🧑 = needs user action (credentials/accounts)

### Phase 0 — Pipeline & deployment skeleton ✅ (code side) / 🧑 (account side)
- ✅ Init repo (`git init` local; no GitHub remote yet), Vite 6 + React 19 + TS 5.7 strict scaffold, ESLint 9 flat / Prettier / `tsc`, Vitest.
- ✅ GitHub Actions CI: `lint | typecheck | test | build` + service-key leak grep.
- ✅ `vercel.json`, `.env.example`, `.env.local` (placeholders), `api/health.ts`, `supabase/migrations/0001_init.sql` (schema + RLS + RPCs + realtime policies), `supabase/config.toml`, PWA manifest/favicon.
- 🧑 Connect repo to GitHub + Vercel (Git integration) — needs user accounts.
- 🧑 Create Supabase project (region nearest players), enable Anonymous Sign-Ins, disable "Allow public access" in Realtime settings, **apply `0001_init.sql`** (never applied — no credentials yet).
- 🧑 Set env vars in Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- ⬜ Push → CI green → auto-deployed shell live on Vercel URL.
- ⬜ *Exit criteria:* push → CI green → auto-deployed shell live on Vercel URL. **(blocked on 🧑 items above)

### Phase 1 — Foundation + Snake ✅
- ✅ Core: fixed-timestep loop (60Hz accumulator), input abstraction (keyboard/touch/swipe/gamepad/virtual), procedural WebAudio SFX + generative music, mulberry32 RNG, localStorage utils, theme system + toggle, error boundaries, settings context (live Proxy).
- ✅ App shell: routes (`/`, `/play/:gameId`, `/settings`, `/leaderboard/:gameId?`, 404), NavBar, HomePage (hero, categories, search, card grid), GamePage, GameHost (canvas fit/DPR, pause, auto-pause, overlays, HUD, controls legend), GameThumb (attract-frame thumbnails), design system CSS.
- ✅ **Snake** complete (grid logic + engine, wrap-wall setting, local best, unit tests + host integration test).
- ✅ *Exit:* playable Snake at 60fps on desktop and phone. **(verified in jsdom; real-device pass deferred to Phase 6 matrix)**

### Phase 2 — Game library ✅
- ✅ **2048** (`src/games/g2048/`), **Breakout** (`breakout/`), **Tetris-style** (`tetris/`, id `blocks`), **Pong hotseat** (`pong/`), **Tic-Tac-Toe hotseat** (`ttt/`) — each with pure `logic.ts` + `logic.test.ts` + `engine.ts`.
- ✅ Registered all 6 games in `src/games/registry.ts` (metadata, accents, controls, how-to-play, lazy loads).
- ✅ Homepage grid + category chips + search + generated thumbnails (480×320 attract frames).
- ✅ How-to-play modals + control legends for every game.
- ✅ Integration test boots **every** game in the registry (`src/test/games.test.tsx`).
- ✅ *Exit:* all 6 games playable solo/locally; library browsable.

### Phase 3 — Polish + leaderboards (first "online" value) ✅ (code side) / 🧑 (live check)
- ✅ **PWA:** `public/sw.js` (precaches shell, network-first navigations, SWR for hashed assets, offline solo), manifest fields, apple/mobile metas, PROD-only registration in `main.tsx`.
- ✅ **Supabase wiring:** `src/lib/supabase.ts` (null-safe client, degrades when env is placeholder/missing), `src/lib/auth.tsx` (ProfileProvider: anonymous sign-in on first visit, `ensure_profile` RPC, `useProfile()`), `src/ui/ProfileGate.tsx` (display-name prompt + edit button), NavBar shows name; `src/App.tsx` wraps providers.
- ✅ **`api/submitScore.ts`:** JWT verify → `validateScore` → service-role insert → optional rank; 400/401/405/503 ladder. Shared caps in `src/shared/scoreRules.ts` (+11 tests). Client helper `src/lib/submit.ts` (never throws).
- ✅ **Leaderboard pages:** `src/pages/LeaderboardPage.tsx` rewritten — per-game tabs, `leaderboard` RPC, loading/empty/offline states, refresh.
- ✅ **Settings page** — volume sliders (master/music/sfx), difficulty, wrap walls, left-handed, reduced motion, show controls, theme seg, reset; persisted via `useSettings()`.
- ✅ **Mobile polish** — virtual d-pad + A/B cluster in `GameHost` (mirrored by `settings.leftHanded`), safe-area inset CSS, landscape prompt for Pong, d-pad only on coarse pointers, score submission leader line.
- ✅ **Wire score submission:** `GameHost` game-over calls `submitScore` for `game.players === 1` games with rank toast line.
- ✅ **Final Phase 3 verification:** `lint · typecheck · test · build` all green after edits.
- ✅ *Exit:* code complete; the live leaderboard check needs 🧑 Supabase migration + env keys.

### Phase 4 — Online vs friend ✅ (code side) / 🧑 (live verification)
- ✅ Room creation/join via code + invite links (`/play/{id}?room=CODE`); lobby with presence ready-up (host starts); reconnect/backoff logic (exponential 1s→30s, resubscribe, ready/started payload preserved) — `src/net/useRoom.ts`, `backoff.ts`, `presence.ts`, `src/ui/ModeSelect.tsx`, `Lobby.tsx`, `FriendMatch.tsx`.
- ✅ **Tic-Tac-Toe online** — server-authoritative `ttt_create`/`ttt_move` RPCs; DB row is the truth (SELECT fetch + monotonic `updated_at` guard) with realtime broadcast wake-ups; `src/net/useTttNet.ts` + online mode in `src/games/ttt/engine.ts`.
- ✅ **Pong online** — host-client: host simulates both paddles at 60Hz and emits 12Hz snapshots + step events; guest sends input on change (≤25Hz), applies snaps, extrapolates the ball, smooths the opponent paddle — `src/games/pong/engine.ts` + snap helpers in `pong/logic.ts`.
- ✅ Disconnection UX: 90s pause-grace overlay with countdown → forfeit win (`GameHost`), connection-lost card, lobby reconnect attempts, display names + ready badges in lobby; Victory/Defeat/Draw result titles; online hides Restart/Play-again (avoids desync); touch pad follows role (guest controls right paddle).
- ✅ *Exit:* two browser windows complete a TTT match and a Pong match on the production URL; killing a tab mid-Pong pauses and resumes correctly. **(code complete; blocked on 🧑 Supabase project + production deploy for the live check)**

### Phase 5 — Matchmaking + ELO ✅ (code side) / 🧑 (live exit)
- ✅ Client UI for `enqueue` RPC: ranked/casual toggle in `ModeSelect`, `QueueSearch` screen with elapsed clock + expanding skill window, `useQueue` polling (4s) + private `user:{uid}` `matched` broadcast listener, cooldown/error states — `src/net/useQueue.ts`, `src/ui/QueueSearch.tsx`, `src/ui/ModeSelect.tsx`.
- ✅ Queue → lobby → match flow: `joinMatch` in `useRoom` adopts the assigned `matches` row (role, opponent, ready), `Lobby` `variant="queue"` auto-starts when the opponent is present, `enqueue(mode)`/`dequeue` RPCs (migration: `match_queue.mode` column + mode-aware `enqueue`).
- ✅ `api/reportMatch` consensus reporting → `finish_match`: both clients POST, first report stored in `match_reports`, second compared (agree → `finish_match`, disagree or >60s stale → void), TTT winner read authoritatively from the `ttt_games` row; client retries `[5s,10s,15s,30s,30s]` so the timeout-void can trigger; ELO K=32 applied for ranked matches — `api/reportMatch.ts`, `src/lib/report.ts`, `src/shared/match.ts`.
- ✅ Rating display + history: `/history` page (last 10, opponent names, W/L/Draw/Void/Unfinished, elo delta column), NavBar `.elo-chip` rating, post-match rating line under the result — `src/pages/HistoryPage.tsx`, `src/ui/NavBar.tsx`, `src/ui/GameHost.tsx`.
- ✅ Unit tests: `src/shared/elo.ts`, `src/shared/match.ts`, `useQueue` parse-enqueue-result (26 tests).
- ⬜ *Exit:* two fresh profiles matched into a ranked TTT + Pong; ELO changes visible; deliberate disagreement voids the match. **(blocked on 🧑 Supabase + deploy)**

### Phase 6 — Hardening & ship ✅ (code side) / 🧑 (dashboard + manual checks)
- ✅ Rate limits: per-instance sliding-window limiter (`src/shared/rateLimit.ts`) wired into `api/submitScore` (10/min) and `api/reportMatch` (30/min) with 429 + `Retry-After`; RLS audit done; service-key exposure check in CI (`grep -R --exclude='*.map' "service_role" dist/` — maps excluded, supabase-js doc comments match otherwise).
- ✅ Sentry error tracking: `@sentry/react` installed, lazy `initMonitoring()` only when `PROD` + `VITE_SENTRY_DSN`, `captureError()` hooked into the app error boundary — `src/lib/monitoring.ts`, `src/core/errorBoundary.tsx`.
- ✅ Privacy-friendly analytics: Umami script injection gated on `PROD` + `VITE_UMAMI_SRC`/`VITE_UMAMI_WEBSITE_ID`, `trackEvent('game-open')` on `GamePage` — `src/lib/analytics.ts`.
- ✅ Performance pass: initial JS **158.7 KB gzip** (< 200 KB budget), all page chunks lazy (GamePage/HistoryPage/LegalPage/engines), `build.sourcemap: true`.
- ✅ Privacy policy + Terms (`/privacy`, `/terms`), skip-link, footer, README (setup/deploy/architecture), `.env.example` updated.
- ⬜ *Exit:* Lighthouse perf > 90, cross-browser/device matrix, Vercel Firewall rule, Supabase message-budget check — all 🧑/manual on production.

### 10.1 Build Status & Resume Notes (updated 2026-10-02)

**Last verified state:** `npm run format` ✅ · `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (20 files, 208 tests) · `npm run build` ✅ · CI grep for `service_role` in bundle ✅ (sourcemaps excluded — only hit is a supabase-js doc comment in `supabase-*.js.map`).

**✅ COMPLETED (code side, all verified green):**
1. Phase 0 — repo, Vite/React/TS scaffold, ESLint/Prettier/tsc, Vitest, GitHub Actions CI, `vercel.json`, `.env.example`, `api/health.ts`, full `0001_init.sql` migration (schema + RLS + RPCs + realtime policies), PWA manifest.
2. Phase 1 — core loop/input/audio/RNG/storage/theme/settings, app shell (routes, NavBar, HomePage, GamePage, GameHost, GameThumb, error boundaries, design-system CSS), Snake.
3. Phase 2 — 2048, Breakout, Blocks (Tetris), Pong hotseat, TTT hotseat; registry, homepage grid/filters/search, generated thumbnails, how-to-play + control legends, all-games boot test.
4. Phase 3 — PWA service worker, Supabase client + anonymous auth + display-name gate, `api/submitScore` + score validation, leaderboard page, Settings page (all controls), mobile polish (touch d-pad/A-B, left-handed mirror, safe areas, Pong landscape hint), score submission hookup with rank line.
5. Phase 4 — friend rooms: `useRoom` (create/join RPCs, presence ready-up, host start, exponential reconnect 1s→30s with payload preservation), ModeSelect/Lobby/FriendMatch UI, invite links (`/play/{id}?room=CODE`), TTT online (server-authoritative `ttt_create`/`ttt_move`, DB-row truth + broadcast wake-ups via `useTttNet`), Pong online (host sim, 12Hz snapshots + step events, guest input send-on-change, ball extrapolation), disconnect UX (90s pause-grace overlay → forfeit win, connection-lost card, Victory/Defeat/Draw titles, role-aware touch pad, desync-safe hidden restart), unit tests for backoff/presence/TTT row parsing/Pong snapshots.
6. Phase 5 — ranked/casual matchmaking: `useQueue` (enqueue/dequeue + 4s poll + `user:{uid}` matched broadcast + cooldown/error handling), `QueueSearch` screen, mode-aware `enqueue(p_game_id, p_mode)` + `match_queue.mode` in migration, `joinMatch` room adoption, auto-start queue lobby, `api/reportMatch` consensus (agree → `finish_match` ELO K=32, disagree/stale >60s → void, TTT winner from `ttt_games`), `reportMatch` client with 5-step retry, `/history` page (last 10, W/L/Draw/Void, elo delta), NavBar rating chip, post-match rating line; tests: `shared/elo.ts`, `shared/match.ts`, `useQueue` parser (26 tests).
7. Phase 6 — hardening: sliding-window rate limits in `api/submitScore` (10/min) + `api/reportMatch` (30/min), CI service-key grep (`.map` excluded), `@sentry/react` lazy init + `captureError` in error boundary, Umami analytics gated on prod env, skip-link + footer, `/privacy` + `/terms` pages, README + `.env.example`, bundle 158.7 KB gzip (< 200 KB budget).

**⬜ REMAINING (in resume order):**
1. **🧑 User actions (block ALL live e2e):** create Supabase project → enable Anonymous Sign-Ins → disable Realtime "Allow public access" → apply `supabase/migrations/0001_init.sql` → put real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` in `.env.local` + Vercel, `SUPABASE_SERVICE_ROLE_KEY` in Vercel only (optional: `VITE_SENTRY_DSN`, `VITE_UMAMI_SRC`/`VITE_UMAMI_WEBSITE_ID`) → connect GitHub repo + import to Vercel → push (CI green → deployed) → Vercel Firewall rate rule for `/api/*`.
2. **Phase 3 exit check (live):** submit a Snake run → appears on the global leaderboard.
3. **Phase 4 exit check (live):** two browser windows → friend TTT match + friend Pong match via invite link; kill a tab mid-Pong → paused → resumes within 90s.
4. **Phase 5 exit check (live):** two fresh profiles → ranked TTT + Pong matched via queue; ELO/rating visibly changes on `/history`; deliberate score disagreement → voided match.
5. **Phase 6 exit checks (manual):** Lighthouse perf > 90 on production; cross-browser/device matrix (Chrome, Edge, Firefox, iOS Safari, Android Chrome × keyboard + touch); Supabase message-budget check; then the §11 Final checklist.

**Phase 4 architecture (for Phase 5 reuse):**
- `GamePage` view machine: local GameHost (default, keeps tests green) ↔ `FriendMatch` (via topbar `vs` button on `game.online` titles, or `?room=CODE` invite links).
- `FriendMatch` = `ModeSelect` (create/join/local) → `Lobby` (code + copy invite, ready-up, host Start) → match. Match gate = presence `started` flag; TTT additionally runs idempotent `ttt_create(match_id)` (row-locked, safe from both sides) then `useTttNet(game_id)`.
- Net hooks (`NetHooks`) travel through `GameCreateArgs.online = { role, hooks, initial }`; Pong uses the room channel directly, TTT uses the private `topic:{game_id}` channel where the DB row is authoritative.
- `GameHost` disconnect grace: `connection.opponentPresent` → 90s countdown overlay → forfeit `onGameOver({ win: true, meta: { winner, forfeit: true } })`; updates freeze while dropped.

**Conventions to keep:** zero code comments, no `any`, Prettier (no semicolons, single quotes), `lint --max-warnings 0`, never `git commit` unless explicitly asked, each game = `logic.ts` + `logic.test.ts` + `engine.ts` pure of DOM side effects outside `create()`/`destroy()`, ids: `snake | 2048 | breakout | blocks | pong | ttt`.

---

## 11. Verification (Definition of Done)

Every phase:
1. `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` all green (CI).
2. Manual matrix: Chrome/Edge/Firefox + iOS Safari/Android Chrome; keyboard + touch.
3. Phase-specific checks as listed in §10 exit criteria.

Final:
- [ ] Two-browser room test (2 windows, same machine *and* 2 devices) passes on production URL.
- [ ] Solo score shows on global leaderboard after submit; direct DB insert from client is rejected (RLS).
- [ ] Ranked match updates both ELOs; mismatched reports void the match.
- [ ] Supabase usage well under quota after a test session.
- [ ] Solo games work with network disabled (PWA offline).
- [ ] No service-role key in client bundle (grep built assets).

---

## 12. Improvements & Suggestions (prioritized)

### Do now (high value / low cost)
1. **Deploy from Phase 0** — deployment never becomes a risky big-bang at the end.
2. **Anonymous auth instead of email login** — real accounts + RLS with zero friction; claim/link later.
3. **Server-authoritative TTT from day one** — nearly free in SQL; makes ranked TTT cheat-proof.
4. **Private channels with `realtime.messages` RLS** — room codes alone are guessable; membership-checked topics close the hole.
5. **Same-region pick** (Supabase region nearest players) — halves Pong latency more than any code tweak.
6. **Graceful degradation** — Supabase down ≠ site down; solo + local scores keep working.
7. **Message-budget monitoring** from Phase 4 (Supabase usage alerts) — tune rates before hitting walls.
8. **Presence discipline** — `track()` only on explicit actions (5 calls/30s/client limit).
9. **Queue pruning inside the RPC** — no dependency on pg_cron.
10. **Consensus reporting for ranked Pong** — both clients must agree or the match is void.
11. **Code-split every game** + error boundary per game.
12. **Generated card thumbnails** — no image assets to source/license.
13. **"How to play" + control legend per game** — biggest retention lever for casual games.
14. **PWA + offline solo games** — installability is a big win for an arcade site.
15. **Accessibility basics** — keyboard nav, ARIA, contrast, reduced motion, auto-pause.

### Defer until data justifies it
16. Replay-based score verification / server referee for ranked Pong (host-client residual cheating is acceptable at hobby scale).
17. Email magic-link claiming of anonymous profiles → cross-device progress; friend lists.
18. Emotes/pings instead of chat (message-cost aware).
19. Offline score queue (service worker buffers submits, flushes when online).
20. Per-game SEO/OG images; "Sponsor a game" or banner ads → **only after upgrading off Vercel Hobby (non-commercial)**.
21. Breakout 2P battle variant, Snake vs ghost, Tetris garbage-line vs mode.
22. Profile pages with stats (win rate, games played, ELO graph).
23. pg_cron cleanup of orphaned anonymous users (>30 days) if available in the project.

### Ops & content
24. GitHub Actions CI on every push (lint/typecheck/test/build) — already in Phase 0.
25. Error tracking (Sentry) + analytics (Plausible/Umami).
26. README with local dev + deploy docs; keep this plan updated as decisions change.
27. Invite deep-links (`?room=`) with a copy button — share friction killer.

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Free-tier ceilings (100 ev/s, 2M msgs/mo) | Matches get throttled | Rate tuning levers (§8), usage alerts, Supabase Pro $25/mo path |
| Host-client trust model in ranked Pong | Host could fake results | Consensus reporting → void on disagreement; accept residual risk at hobby scale; future referee |
| Realtime Authorization is Public Beta (supabase-js ≥ 2.44) | Channel join failures | Pin supabase-js version; fallback = public channels + high-entropy topics |
| Pong latency (~100-200ms) | Feels laggy for guests | Local paddle prediction; same-region selection; lower snapshot cadence as last resort |
| Anonymous users accumulate | Row clutter | Optional cleanup job (§10.23); MAU ample at 50k |
| Vercel Hobby non-commercial | Blocker if monetizing | Upgrade plan before any ads/sponsors |
| Region mismatch (Vercel fn vs Supabase) | Extra API latency | Keep `submitScore`/`reportMatch` in the same region as the Supabase project |
| Room-code enumeration | Stranger joins a lobby | Private channels + membership RLS (mitigation #4) |
| Cold starts | None significant | No long-running server by design |

---

## 14. Setup Steps (one-time, after build)

1. **Supabase:** create project (region = nearest players) → Authentication → Providers → enable **Anonymous** → Realtime → Settings → **disable "Allow public access"**.
2. Apply migrations: `supabase db push` (CLI) or paste `supabase/migrations/0001_init.sql` into the SQL editor.
3. Copy project URL, anon key, service role key.
4. **Vercel:** import GitHub repo (framework preset: Vite) → add env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) → deploy.
5. Verify: production URL loads, anonymous sign-in works, a test score lands in `scores`.
