# FormCoach AI (demo)

A local demo of a camera-based exercise coach. The browser detects your skeleton with MediaPipe,
counts reps, checks form, and saves every session and rep to PostgreSQL.
Supported exercises: squat, bicep curl, shoulder press.

The full spec and backlog live in [CLAUDE.md](CLAUDE.md).

## Requirements

- Docker Desktop (Apple Silicon is fine)
- A webcam and Chrome / Edge / Safari

## Run

```bash
make check-ports   # verify host ports 5180, 8010, 55432, 8090 are free
make up            # build and start everything
```

| What      | URL                                                           |
| --------- | ------------------------------------------------------------- |
| App       | http://localhost:5180 (use `localhost`, not the IP — camera)  |
| API docs  | http://localhost:8010/docs                                    |
| Adminer   | http://localhost:8090 (PostgreSQL, server `db`, `formcoach`)  |
| DB (host) | `localhost:55432`                                             |

Other commands: `make down`, `make logs`, `make ps`, `make test`, `make seed`, `make reset`.

Ports are configured in `.env` (copied from `.env.example` on first run).

## Progress

Mirrors the backlog in [CLAUDE.md §13](CLAUDE.md). Updated after every ticket.

### Milestone 0 — Project skeleton & infrastructure ✅

- [x] T-01 Repo scaffold — folders, `.env.example`, `Makefile` with `check-ports`
- [x] T-02 docker-compose — `fc_db`, `fc_backend`, `fc_frontend`, `fc_adminer` on 5180 / 8010 / 55432 / 8090
- [x] T-03 Backend skeleton — FastAPI, config, CORS, `/api/health` with DB check
- [x] T-04 Frontend skeleton — Vite + React 18, router, "Backend: connected" in the header

### Milestone 1 — Database & API ✅

- [x] T-05 Models + Alembic migration (runs on backend start)
- [x] T-06 Idempotent seed — 3 exercises + Demo User
- [x] T-07 Users & exercises endpoints
- [x] T-08 Sessions & reps endpoints — server-side aggregates, retry-safe rep posts
- [x] T-09 Stats endpoint — `/api/users/{id}/stats`
- [x] T-10 Backend tests — 59 pytest tests against a separate test database

### Milestone 2 — Pose detection in the browser ✅

- [x] T-11 Camera hook — friendly errors (denied, no camera, busy, unplugged)
- [x] T-12 Pose landmarker — local model + WASM, GPU → CPU fallback, ~30 fps
- [x] T-13 Skeleton overlay + debug panel (press `D`)

### Milestone 3 — Engine core ✅

- [x] T-14 Geometry + pixel conversion
- [x] T-15 Smoothing, visibility gate (incl. in-frame check), side selection
- [x] T-16 Rep state machine — both directions, hysteresis, min/max rep time, partial reps
- [x] T-17 Scoring + `make check-codes` (frontend/backend error codes stay in sync)
- [x] T-18 Synthetic pose generator for tests
- [x] T-19 Analyzer — frame in → state out

### Milestone 4 — Exercises ✅

- [x] T-20 Squat
- [x] T-21 Bicep curl
- [x] T-22 Shoulder press
- [x] T-23 Live tuning sliders in the debug panel (+ orientation check and "not counted" feedback after the first live test)

### Milestone 5 — Workout flow & persistence (in progress)

- [x] T-24 Home page — user picker/creator, exercise cards
- [x] T-25 Workout page — setup checklist, 3-2-1 countdown, live counters, banner, angle gauge
- [x] T-26 Persist session — reps saved live with a retry queue (survives a backend outage)
- [ ] T-27 Voice & feedback — spoken rep counts and cues, mute toggle
- [ ] T-28 Summary page

### Milestone 6 — History & polish

- [ ] T-29 History page with charts
- [ ] T-30 Visual polish
- [ ] T-31 Demo data script (`make demo-data`)
- [ ] T-32 README & presentation script
- [ ] T-33 Final verification from a fresh clone

### Stretch

- [ ] S-01 Rep-by-rep angle replay on the Summary page
- [ ] S-02 Personal calibration
- [ ] S-03 Fourth exercise
- [ ] S-04 Export session as PDF/CSV

**Tests:** `make test` — 59 backend + 204 frontend (engine, sync) tests, plus the error-code check.
