# CLAUDE.md — FormCoach AI (Demo)

This file is the single source of truth for building this project. Read it fully before writing code.
Work through the **Backlog** (bottom of this file) in order, one ticket at a time. After finishing a
ticket, verify it against its acceptance criteria, then tick its checkbox in this file.

---

## 1. What we are building

A **local, working demo** of a camera-based AI exercise coach, similar to Kemtai / ASENSEI.

The user stands in front of a laptop webcam and performs an exercise. The app:

1. Detects the body skeleton in real time (no wearables, camera only).
2. Calculates joint angles from the skeleton.
3. **Counts reps correctly** (no false counts from jitter or half movements).
4. **Detects form mistakes** and gives on-screen + spoken feedback.
5. Gives each rep a quality score (0–100).
6. **Saves every session and every rep to a PostgreSQL database.**
7. Shows session history and simple progress stats.

Supported exercises (3 body parts):

| Exercise       | Body part   | Camera view |
| -------------- | ----------- | ----------- |
| Squat          | Legs / hips | Side view   |
| Bicep curl     | Arms        | Side view   |
| Shoulder press | Shoulders   | Front view  |

**Priority order: correctness of calculations > reliability > data persistence > UI polish.**
It must never show wrong things. When the app is unsure (body not visible, low confidence), it must
say so and pause, never guess.

This is a presentation demo, not a medical product. No auth, no cloud, no payment.

---

## 2. Tech stack (do not change without a strong reason)

| Layer          | Choice                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Pose model     | Google MediaPipe **Pose Landmarker** via `@mediapipe/tasks-vision` (runs in the browser, 33 landmarks) |
| Frontend       | Vite + React 18 + TypeScript, plain CSS modules (no heavy UI lib needed)                               |
| Engine         | Pure TypeScript module inside frontend (`frontend/src/engine/`) — all math lives here                  |
| Frontend tests | Vitest                                                                                                 |
| Backend        | Python 3.12 + FastAPI + SQLAlchemy 2.x + Alembic + Pydantic v2                                         |
| Backend tests  | pytest + TestClient (httpx2)                                                                           |
| Database       | PostgreSQL 16                                                                                          |
| DB admin UI    | Adminer (for showing live data during the presentation)                                                |
| Orchestration  | docker-compose                                                                                         |
| Charts         | Recharts                                                                                               |
| Voice cues     | Browser Web Speech API (`speechSynthesis`)                                                             |

Why pose detection runs in the browser: video never leaves the laptop (fast, private, no GPU server
needed). The backend only receives computed results (reps, scores, errors).

---

## 3. Architecture

```
┌─────────────────────────── Browser (localhost:5180) ───────────────────────────┐
│ Webcam → MediaPipe PoseLandmarker → landmarks (33 pts / frame)                 │
│        → engine/ (smoothing → visibility gate → angles → rep state machine     │
│                    → form rules → rep score)                                   │
│        → UI (video + skeleton overlay + rep counter + feedback + voice)        │
│        → REST calls to backend (start session, post rep, finish session)       │
└────────────────────────────────────────────────────────────────────────────────┘
                                   │ HTTP JSON
                                   ▼
                   FastAPI backend (localhost:8010)  →  PostgreSQL (host 55432)
                                                        Adminer (localhost:8090)
```

---

## 4. Repository layout

The repo root is the current folder (`argus/`); `formcoach` is the compose project name, not a subfolder.

```
argus/
├── CLAUDE.md
├── README.md                      # how to run + presentation script
├── docker-compose.yml
├── .env.example
├── Makefile                       # make up / down / logs / test / seed / reset
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml (or requirements.txt)
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                # FastAPI app, CORS, routers
│   │   ├── config.py              # settings from env
│   │   ├── db.py                  # engine, session dependency
│   │   ├── models.py              # SQLAlchemy models
│   │   ├── schemas.py             # Pydantic schemas
│   │   ├── routers/
│   │   │   ├── health.py
│   │   │   ├── users.py
│   │   │   ├── exercises.py
│   │   │   ├── sessions.py
│   │   │   └── stats.py
│   │   └── seed.py                # seeds exercises + demo user
│   └── tests/
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── scripts/fetch-model.sh                     # downloads the model if missing (see §9)
    ├── public/models/pose_landmarker_full.task   # gitignored; fetched by the script above
    └── src/
        ├── main.tsx, App.tsx
        ├── api/client.ts          # typed fetch wrapper for backend
        ├── pose/
        │   ├── usePoseLandmarker.ts   # loads model, runs detectForVideo per frame
        │   └── useCamera.ts
        ├── engine/                # PURE FUNCTIONS, NO REACT, NO DOM — fully unit tested
        │   ├── landmarks.ts       # index constants + types
        │   ├── geometry.ts        # angle, vertical-angle, distance, pixel conversion
        │   ├── smoothing.ts       # EMA filter
        │   ├── visibility.ts      # visibility gate
        │   ├── repCounter.ts      # generic state machine
        │   ├── scoring.ts
        │   ├── exercises/
        │   │   ├── types.ts       # ExerciseDefinition interface
        │   │   ├── squat.ts
        │   │   ├── bicepCurl.ts
        │   │   └── shoulderPress.ts
        │   ├── analyzer.ts        # ties everything together: frame in → state out
        │   └── __tests__/
        ├── components/
        │   ├── VideoCanvas.tsx    # video + skeleton overlay
        │   ├── RepCounter.tsx
        │   ├── FeedbackBanner.tsx
        │   ├── DebugPanel.tsx     # live angles, state, visibility (toggle with "D")
        │   └── ...
        └── pages/
            ├── HomePage.tsx       # pick user + exercise
            ├── WorkoutPage.tsx    # live session
            ├── SummaryPage.tsx    # result of the session just finished
            └── HistoryPage.tsx    # past sessions + charts
```

---

## 5. docker-compose services

### 5.1 Port rules — STRICT

The developer's machine already runs other Docker stacks. **These host ports are taken and must
NEVER be used** (not by any service, not temporarily, not in tests):

```
3001, 5672, 6379, 8123, 9000, 9001, 9002, 9090, 9092, 9093, 15672, 54320
```

Also avoid the common defaults `5432`, `3000`, `8000`, `8080`, `5173` to stay safe from future clashes.

**This project uses only these host ports:**

| Service  | Host port | Container port | URL                                          |
| -------- | --------- | -------------- | -------------------------------------------- |
| frontend | **5180**  | 5180           | http://localhost:5180                        |
| backend  | **8010**  | 8010           | http://localhost:8010 (docs: `/docs`)        |
| db       | **55432** | 5432           | connect from host tools on `localhost:55432` |
| adminer  | **8090**  | 8080           | http://localhost:8090                        |

Rules:

- All host ports come from `.env` variables (`FRONTEND_PORT`, `BACKEND_PORT`, `DB_HOST_PORT`,
  `ADMINER_PORT`) with the defaults above, so they can be changed in one place.
- Inside the Docker network, services talk via service names (`db:5432`, `backend:8010`); host ports
  are only for the browser and host tools.
- Before the first `docker compose up`, run `make check-ports`, which uses `lsof -iTCP:<port> -sTCP:LISTEN`
  for each of the 4 ports and fails with a clear message if one is busy. `make up` runs it first.
- Do not expose ports for anything else (no extra exporters, no debug ports).

### 5.2 Isolation from other stacks

- Compose project name: `name: formcoach` at the top of `docker-compose.yml`.
- All container names are prefixed `fc_` (`fc_db`, `fc_backend`, `fc_frontend`, `fc_adminer`).
- Own network `fc_net` and own volume `fc_pgdata`. Never attach to, reuse, or modify other projects'
  networks, volumes, or containers (e.g. anything named `ddd_*` or `dd_*`).
- `make down` / `make reset` must only affect this project (`docker compose -p formcoach ...`).
  Never run `docker system prune`, `docker volume prune`, or stop containers that aren't ours.

### 5.3 Services

| Service    | Image / build        | Notes                                                                                                                                                                          |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db`       | `postgres:16-alpine` | volume `fc_pgdata`, healthcheck with `pg_isready`                                                                                                                              |
| `backend`  | `./backend`          | waits for `db` healthy; on start runs `alembic upgrade head` then `python -m app.seed` (idempotent) then `uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload`            |
| `frontend` | `./frontend`         | Vite dev server: `vite --host 0.0.0.0 --port 5180 --strictPort`; also set `server.port: 5180`, `strictPort: true` in `vite.config.ts`; source mounted as volume for hot reload |
| `adminer`  | `adminer`            | for showing DB contents live                                                                                                                                                   |

Env vars (in `.env`, with `.env.example` committed):
`FRONTEND_PORT=5180`, `BACKEND_PORT=8010`, `DB_HOST_PORT=55432`, `ADMINER_PORT=8090`,
`POSTGRES_USER=formcoach`, `POSTGRES_PASSWORD=formcoach`, `POSTGRES_DB=formcoach`,
`DATABASE_URL=postgresql+psycopg://formcoach:formcoach@db:5432/formcoach`,
`CORS_ORIGINS=http://localhost:5180`, `VITE_API_URL=http://localhost:8010`.

Webcam access: browsers only allow the camera on `https` or `localhost`. Always open the app at
`http://localhost:5180` (not the machine IP).

The developer is on macOS (Apple Silicon). All images must support `linux/arm64` (the ones listed do).

One command must start everything: `docker compose up --build`.

---

## 6. Database schema

```
users
  id            UUID PK
  name          TEXT NOT NULL UNIQUE
  created_at    TIMESTAMPTZ default now()

exercises
  id            SERIAL PK
  slug          TEXT UNIQUE NOT NULL     -- 'squat' | 'bicep_curl' | 'shoulder_press'
  name          TEXT NOT NULL
  body_part     TEXT NOT NULL            -- 'legs' | 'arms' | 'shoulders'
  camera_view   TEXT NOT NULL            -- 'side' | 'front'
  instructions  TEXT NOT NULL

sessions
  id            UUID PK
  user_id       UUID FK → users ON DELETE CASCADE
  exercise_id   INT  FK → exercises
  started_at    TIMESTAMPTZ NOT NULL
  ended_at      TIMESTAMPTZ NULL         -- null while in progress
  total_reps    INT default 0
  good_reps     INT default 0            -- reps with score >= 70 and no FORM errors (see §8.8)
  avg_score     NUMERIC(5,2) NULL
  duration_ms   INT NULL

reps
  id            UUID PK
  session_id    UUID FK → sessions ON DELETE CASCADE
  rep_index     INT NOT NULL             -- 1, 2, 3 ...
  started_at    TIMESTAMPTZ NOT NULL
  duration_ms   INT NOT NULL
  min_angle     NUMERIC(6,2) NOT NULL    -- primary angle min during rep
  max_angle     NUMERIC(6,2) NOT NULL    -- primary angle max during rep
  score         INT NOT NULL             -- 0..100
  errors        JSONB NOT NULL default '[]'   -- list of error codes, e.g. ["SQUAT_SHALLOW"]
  metrics       JSONB NOT NULL default '{}'   -- extra per-rep numbers (e.g. max_torso_lean)
  UNIQUE (session_id, rep_index)
```

Seed data: the 3 exercises above + one user named `Demo User`.
Use Alembic for migrations (no `create_all` in production code paths).

---

## 7. REST API (prefix `/api`)

| Method | Path                                           | Purpose                                                                                                                           |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                                  | `{status:"ok", db:"ok"}` — checks DB connection                                                                                   |
| GET    | `/api/users`                                   | list users                                                                                                                        |
| POST   | `/api/users`                                   | `{name}` → create user (409 if name exists)                                                                                       |
| GET    | `/api/exercises`                               | list exercises                                                                                                                    |
| POST   | `/api/sessions`                                | `{user_id, exercise_slug}` → create session, returns session                                                                      |
| POST   | `/api/sessions/{id}/reps`                      | save one rep (called live after every completed rep, so data appears in the DB during the demo)                                   |
| POST   | `/api/sessions/{id}/finish`                    | `{ended_at}` → server recomputes `total_reps`, `good_reps`, `avg_score`, `duration_ms` from stored reps                           |
| GET    | `/api/sessions?user_id=&exercise_slug=&limit=` | list sessions newest first                                                                                                        |
| GET    | `/api/sessions/{id}`                           | session with its reps                                                                                                             |
| DELETE | `/api/sessions/{id}`                           | delete a session                                                                                                                  |
| GET    | `/api/users/{id}/stats`                        | per exercise: total sessions, total reps, avg score, best session, last 10 session scores (for charts), most frequent error codes |

Rules:

- Validate everything with Pydantic (score 0–100, rep_index ≥ 1, angles 0–180, known error codes).
- Posting a rep to a finished session → 409.
- Aggregates are always computed on the server from `reps`, never trusted from the client.
- Frontend must queue rep posts and retry if the backend is briefly unavailable (don't lose reps).
- FastAPI auto docs at `http://localhost:8010/docs` must work (useful for the presentation).

---

## 8. THE ENGINE — calculation specification (most important part)

All engine code is pure TypeScript functions with no React/DOM dependencies, so it can be unit
tested with synthetic data. Every threshold lives in the exercise definition file as a named constant
(easy to tune), never hard-coded inside logic.

### 8.1 MediaPipe landmark indices (BlazePose 33-point model)

```
0  nose
11 left_shoulder   12 right_shoulder
13 left_elbow      14 right_elbow
15 left_wrist      16 right_wrist
23 left_hip        24 right_hip
25 left_knee       26 right_knee
27 left_ankle      28 right_ankle
31 left_foot_index 32 right_foot_index
```

Each landmark has `x, y` (normalized 0..1), `z`, and `visibility` (0..1).
Note: MediaPipe "left/right" is the person's left/right. The webcam preview should be mirrored for
display only; do NOT mirror the coordinates used for math.

### 8.2 Coordinate space — critical gotcha

Normalized `x` is relative to frame width and `y` to frame height, so they are NOT in the same units.
**Before any angle math, convert to pixel space:** `px = x * videoWidth`, `py = y * videoHeight`.
Calculating angles directly on normalized coords gives wrong angles on non-square frames.
Image `y` grows downward; "vertical" means the vector `(0, -1)` pointing up.

### 8.3 Geometry (`geometry.ts`)

```ts
// Angle at vertex B formed by points A-B-C, in degrees, range 0..180
angleAt(a, b, c):
  ba = a - b;  bc = c - b
  cos = dot(ba, bc) / (|ba| * |bc|)
  cos = clamp(cos, -1, 1)          // guard against floating point errors
  return degrees(acos(cos))
  // if |ba| or |bc| is ~0, return NaN and let caller treat the frame as invalid

// Angle between a segment (from p1 to p2) and vertical, degrees 0..180
angleFromVertical(p1, p2):
  v = p2 - p1
  return degrees(acos(clamp(dot(v, (0,-1)) / |v|, -1, 1)))
```

### 8.4 Smoothing (`smoothing.ts`)

Apply an exponential moving average to each landmark's pixel coordinates:
`smoothed = alpha * current + (1 - alpha) * previous`, `alpha = 0.5` (constant `SMOOTHING_ALPHA`).
Reset the filter when tracking is lost.

### 8.5 Visibility gate (`visibility.ts`)

Each exercise declares its **required landmarks**. A frame is valid only if all required landmarks
have `visibility >= 0.6` (`MIN_VISIBILITY`) **and** lie inside the frame (normalized x and y within
`[-FRAME_MARGIN, 1 + FRAME_MARGIN]`, `FRAME_MARGIN = 0.02`). Found in T-13: MediaPipe can report
visibility ≈ 0.99 for joints it is only guessing (e.g. knees cut off by the frame edge), so
visibility alone is not enough.

- For side-view exercises, compute the average visibility of the left-side chain and the right-side
  chain, and use the more visible side for the whole set. Re-evaluate only between reps, not mid-rep.
- If frames are invalid for more than 500 ms (`LOST_TRACKING_MS`): state becomes `NOT_VISIBLE`, rep
  counting pauses, the current partial rep is discarded, and the UI shows a specific instruction
  (e.g. "Step back — I can't see your knees").
- Never count a rep or report a form error from invalid frames.
- **Orientation gate (added after the first live test):** a set may only start when the user is
  turned the right way — side view: shoulder width / torso length ≤ 0.45; front view: shoulder
  width / nose-to-shoulder height ≥ 0.8 (`engine/orientation.ts`). Checked only before a rep,
  never mid-rep. While waiting, the UI says exactly what to fix: "Turn sideways to the camera",
  "Face the camera", or the exercise's start hint ("Stand up straight to start"), then shows a
  hold-still progress bar.

### 8.6 Generic rep state machine (`repCounter.ts`)

Every exercise uses the same machine, driven by its **primary angle** and three thresholds:
`startThreshold`, `leaveTopThreshold` (a gap of ~15° past start, in the working direction) and
`endThreshold`. The gap between start and leave-top is the hysteresis that prevents flickering.

```
States: NOT_VISIBLE | READY | TOP | IN_REP      ("end reached" is a flag inside IN_REP, not a state)

READY:  wait until the user holds the start position for 500 ms (START_HOLD_MS) → TOP
TOP:    primary angle is past the START threshold.
        when it crosses the LEAVE_TOP threshold → IN_REP (record rep start time)
IN_REP: track min/max of primary angle and all form metrics every frame
        when the primary angle reaches the END threshold → set endReached = true
        when it returns past the START threshold → rep complete → evaluate → back to TOP
```

Rep is **rejected (not counted)** if:

- its duration < 600 ms (`MIN_REP_MS`) — jitter or bounce, or
- the "end" threshold was never reached — partial rep (don't count). Give the partial cue
  ("Go lower" etc.) only if the rep went at least `PARTIAL_CUE_MIN_TRAVEL` (constant, default 25°)
  past the start threshold — small wobbles near the top are rejected silently, never nagged.

Rep durations > 8 s (`MAX_REP_MS`) → discard and go to READY (the user must hold the start position
again). Not straight to TOP: someone stuck at the bottom would immediately start a new "rep" from
there and could get half a rep counted.

Implement the machine so "direction" is configurable: for squats the angle goes DOWN during the
rep, for shoulder press it goes UP. Exercise definitions declare this.

### 8.7 Exercise definitions

Each file exports an `ExerciseDefinition`:

```ts
interface ExerciseDefinition {
  slug: 'squat' | 'bicep_curl' | 'shoulder_press';
  cameraView: 'side' | 'front';
  requiredLandmarks(side): number[];
  primaryAngle(lm, side): number; // degrees
  direction: 'decreasing' | 'increasing'; // how primary angle moves during the working phase
  startThreshold: number; // "at top/start" position
  leaveTopThreshold: number; // crossing this starts a rep (hysteresis gap from start)
  endThreshold: number; // working phase must reach this
  frameMetrics(lm, side): Record<string, number>; // computed every frame during a rep
  evaluateRep(repData): { errors: ErrorCode[]; score: number }; // run once at rep end
  liveCues(frameMetrics, state): ErrorCode | null; // optional real-time warning mid-rep
  setupInstructions: string;
}
```

#### Squat (side view)

- Landmarks (chosen side): shoulder, hip, knee, ankle.
- Primary angle: **knee** = `angleAt(hip, knee, ankle)`. Direction: decreasing.
- `startThreshold = 160°` (standing), `leaveTopThreshold = 145°`, `endThreshold = 100°` (deep enough to count).
- Frame metrics: `torsoLean = angleFromVertical(hip → shoulder)`.
- Errors:
  - `SQUAT_SHALLOW` — end threshold never reached (rep not counted, cue "Go lower").
  - `SQUAT_TORSO_LEAN` — max torsoLean during rep > 45° (cue "Keep your chest up"). Note: many
    people naturally lean ~45° in a deep squat; tune this live with the debug sliders before the demo.
  - `SQUAT_TOO_FAST` — rep duration < 1000 ms (counted, cue "Slow down").
- Optional bonus metric: depth quality — min knee angle ≤ 90° is "great depth".

#### Bicep curl (side view)

- Landmarks (chosen side): shoulder, elbow, wrist, hip.
- Primary angle: **elbow** = `angleAt(shoulder, elbow, wrist)`. Direction: decreasing.
- `startThreshold = 150°` (arm extended), `leaveTopThreshold = 135°`, `endThreshold = 50°` (fully curled).
- Frame metrics: `upperArmSwing` = angle between `shoulder → elbow` and `shoulder → hip`.
- Errors:
  - `CURL_PARTIAL` — end threshold not reached (not counted, cue "Curl all the way up").
  - `CURL_ELBOW_SWING` — max upperArmSwing during rep > 25° (cue "Keep your elbow pinned to your side").
  - `CURL_NO_EXTENSION` — a rep completes only when the arm returns past 150°, so a user who never
    extends never completes a rep. Detect it inside IN_REP: after `endReached`, if the angle rises to
    a local maximum that stays < 140° (`NO_EXTENSION_ANGLE`) and then starts decreasing again by
    ≥ 15°, the user re-curled without extending → show live cue "Fully extend your arm". The rep is
    not counted (it never completed); this is a live cue only, not a stored rep error.
  - `CURL_TOO_FAST` — duration < 800 ms.

#### Shoulder press (front view)

- Landmarks (both sides): both shoulders, elbows, wrists, plus nose.
- Primary angle: **average elbow angle** of left and right arm. Direction: increasing.
- `startThreshold = 100°` (bottom: hands near shoulders), `leaveTopThreshold = 115°`,
  `endThreshold = 155°` (arms extended). (Here the "top" state of the machine is the bottom of the
  press — "top" always means the start position.)
- Additional rule for top position: both wrists must be above the nose (`wrist.y < nose.y` in pixel
  space) for the rep to count.
- Frame metrics: `armAsymmetry = |leftElbowAngle - rightElbowAngle|`,
  `wristHeightDiff = |leftWrist.y - rightWrist.y| / shoulderWidth`.
- Errors:
  - `PRESS_PARTIAL` — top not reached (not counted, cue "Press all the way up").
  - `PRESS_UNEVEN` — max armAsymmetry > 20° or max wristHeightDiff > 0.25 (cue "Press both arms evenly").
  - `PRESS_TOO_FAST` — duration < 800 ms.

### 8.8 Scoring (`scoring.ts`)

Start at 100, subtract per error, clamp to 0..100:

- form error (lean, swing, uneven): −30
- too fast: −15
- partial reps are not counted, so they don't get a score
- no bonuses (max score is 100)

A rep is "good" if score ≥ 70 and it has no **form** errors (lean, swing, uneven). A rep that is
only too fast (score 85) still counts as good. The backend uses the same rule for `good_reps`.

Only codes that can appear on a counted rep are stored: `SQUAT_TORSO_LEAN`, `SQUAT_TOO_FAST`,
`CURL_ELBOW_SWING`, `CURL_TOO_FAST`, `PRESS_UNEVEN`, `PRESS_TOO_FAST`. Partial / no-extension codes
are live cues only. The backend validates rep errors against this list.

### 8.9 Feedback & voice

- Show the latest cue in a banner for 2.5 s.
- Reps that do NOT count are announced in the banner, not only in the log: "Not counted — Go
  lower", "Not counted — too fast, slow down", "Not counted — I lost sight of you". (Tiny partial
  wobbles near the start stay silent.) Counted reps show "Rep N counted" or "Rep N — <mistake>".
- Speak cues with `speechSynthesis`, with a cooldown of 3 s per cue code (don't nag).
- Speak the rep number on each counted rep ("One", "Two"…). Toggleable mute button.
- Positive feedback after a clean rep sometimes ("Great rep!") — at most once every 3 reps.

### 8.10 Analyzer (`analyzer.ts`)

`createAnalyzer(definition)` returns an object with `processFrame(landmarks, videoW, videoH, timestampMs)`
which returns:

```ts
{
  state, repCount, side,
  primaryAngle, frameMetrics,
  visibilityOk, visibilityMessage,
  liveCue,                 // ErrorCode | null
  completedRep?,           // present only on the frame a rep completes: {index, startedAt, durationMs, minAngle, maxAngle, score, errors, metrics}
  rejectedRep?             // present when a partial rep was rejected: {reason}
}
```

The React layer only renders this output and sends `completedRep` to the backend.

Timestamps: the engine works in `performance.now()` milliseconds (monotonic). The React layer
records a wall-clock anchor (`Date.now()` paired with `performance.now()`) when the session starts
and converts `startedAt` to an ISO timestamp before posting. The engine itself never reads the clock.

### 8.11 Engine tests (mandatory)

Write Vitest tests using **synthetic landmark sequences** (generate points so the knee angle sweeps
170 → 85 → 170 over N frames at 30 fps, etc.). Required tests:

- `angleAt` returns 90 for a right angle, 180 for collinear points, handles zero-length (NaN).
- Pixel conversion: the same pose on a 1280×720 frame gives the correct angle (proves the
  normalized-coords bug is avoided).
- Squat: 5 clean synthetic reps → count = 5, no errors.
- Squat: reps that only reach 120° → count = 0, `SQUAT_SHALLOW` reported.
- Squat: torso leaning 60° → counted with `SQUAT_TORSO_LEAN`.
- Jitter: angle oscillating ±8° around 160 for 3 s → count = 0.
- Too-fast rep (< 600 ms) → rejected.
- Visibility drop mid-rep → partial rep discarded, state `NOT_VISIBLE`, no count.
- Equivalent count/error tests for bicep curl and shoulder press (including uneven press).

---

## 9. Frontend details

- Load the model with `PoseLandmarker.createFromOptions` using `runningMode: "VIDEO"`, `numPoses: 1`,
  GPU delegate with CPU fallback. Use the **full** model
  (`pose_landmarker_full.task`). Download it with `frontend/scripts/fetch-model.sh` (skips if the
  file exists) from
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`
  into `public/models/`. Run the script from the frontend container's **entrypoint**, not a
  Dockerfile `RUN` step — the source bind mount would hide anything baked into the image under
  `public/`. Same for WASM: copy from `node_modules/@mediapipe/tasks-vision/wasm` to `public/wasm`
  at container start (no CDN at runtime, so the demo works offline). Give `node_modules` an
  anonymous volume in compose so the bind mount doesn't hide it either.
- Pin the exact `@mediapipe/tasks-vision` version. Some versions have returned `visibility` as
  0/undefined for pose landmarks — in T-12, verify real visibility values come through before
  building the visibility gate on top of them.
- Run detection in a `requestAnimationFrame` loop with `detectForVideo(video, performance.now())`.
  Skip a frame if the video timestamp hasn't advanced.
- Camera: request 1280×720, `facingMode: "user"`.
- Overlay: draw the skeleton on a canvas over the video. Color the joints used by the current
  exercise; turn them red when a live cue is active, gray when visibility is low.
- Show FPS in the debug panel. Target ≥ 20 fps on a normal laptop.

### Pages

1. **Home** — choose or create a user, pick one of 3 exercise cards (name, body part, camera view
   icon, short instructions).
2. **Workout** — setup screen first ("Stand sideways, full body in frame") with a live "visibility
   check" indicator that turns green when ready, then a 3-2-1 countdown, then the live session:
   big rep counter, good-rep counter, live cue banner, current primary angle gauge, "Finish" button.
   Debug panel (press `D`): primary angle, all frame metrics, state, chosen side, visibility per
   landmark, FPS.
3. **Summary** — total reps, good reps, average score, per-rep table (score, errors, min angle,
   duration), most common mistake with a tip.
4. **History** — list of past sessions per exercise, line chart of avg score over sessions, bar chart
   of reps per session, top mistakes.

### Visual style

Clean, dark theme, large readable numbers (visible from 2–3 m away while exercising), one accent
color. Responsive enough for a laptop screen; mobile is not required.

---

## 10. Commands

```
make check-ports  # verify 5180, 8010, 55432, 8090 are free
make up           # check-ports, then docker compose -p formcoach up --build -d
make down         # docker compose -p formcoach down
make logs         # docker compose -p formcoach logs -f
make test         # run backend pytest + frontend vitest inside containers
make seed         # re-run seed
make reset        # down -v (wipes ONLY this project's DB volume) then up
```

URLs: app http://localhost:5180 · API docs http://localhost:8010/docs · Adminer http://localhost:8090
(system: PostgreSQL, server: `db`, user/pass/db: `formcoach`). Host DB tools: `localhost:55432`.

---

## 11. Coding conventions

- TypeScript `strict: true`. No `any` in `engine/`.
- Engine functions are pure and deterministic; time is passed in, never read from `Date.now()` inside.
- Python: type hints everywhere, `ruff` for lint/format.
- Keep thresholds as named, exported constants with a comment explaining what they mean.
- Small commits per ticket, message format: `T-XX: short description`. (T-01 starts with `git init`.)
- Don't add libraries beyond the stack without a reason noted in the PR/commit message.
- When unsure about a threshold, make it tunable from the debug panel rather than guessing.

## 12. Definition of Done (every ticket)

1. Acceptance criteria met and checked manually or by test.
2. Tests pass (`make test`).
3. `docker compose up --build` from a clean state still works.
4. Checkbox ticked in this file.

---

## 13. BACKLOG

Work top to bottom. Don't start a milestone until the previous one is done.

### Milestone 0 — Project skeleton & infrastructure

- [x] **T-01 Repo scaffold** — Create the folder layout from §4, `.gitignore`, `.env.example`, `Makefile` (including `check-ports`), minimal `README.md`.
      _AC:_ structure matches §4; `make` targets exist; `make check-ports` reports the 4 ports.
- [x] **T-02 docker-compose** — Services `db`, `backend`, `frontend`, `adminer` per §5 with healthchecks, project name `formcoach`, `fc_` container names, own network and volume, ports from `.env`.
      _AC:_ `make up` starts all 4 on ports 5180/8010/55432/8090 only; `docker ps` shows no other port used by `fc_*` containers; the existing `ddd_*` containers are untouched and still running; Adminer can log in to the DB.
- [x] **T-03 Backend skeleton** — FastAPI app, config, DB session, CORS, `/api/health` checking DB.
      _AC:_ `GET /api/health` → `{status:"ok", db:"ok"}`; `/docs` loads.
- [x] **T-04 Frontend skeleton** — Vite + React + TS app with router and 4 empty pages, API client that calls `/api/health` and shows status in the header.
      _AC:_ `localhost:5180` shows "Backend: connected".

### Milestone 1 — Database & API

- [x] **T-05 Models + Alembic migration** — tables from §6.
      _AC:_ migration runs automatically on backend start; tables visible in Adminer.
- [x] **T-06 Seed** — 3 exercises + `Demo User`, idempotent.
      _AC:_ restarting the backend doesn't duplicate rows.
- [x] **T-07 Users & exercises endpoints** — per §7.
- [x] **T-08 Sessions & reps endpoints** — create, add rep, finish (server-side aggregates), list, get, delete.
      _AC:_ validation errors return 422; posting to finished session returns 409; aggregates correct.
- [x] **T-09 Stats endpoint** — `/api/users/{id}/stats` per §7.
- [x] **T-10 Backend tests** — pytest covering T-07..T-09 against a test database.
      _AC:_ `make test` green.

### Milestone 2 — Pose detection in the browser

- [x] **T-11 Camera hook** — permission handling, friendly error if denied or no camera.
- [x] **T-12 Pose landmarker hook** — model + WASM loaded locally per §9, GPU→CPU fallback, rAF loop.
      _AC:_ landmarks logged per frame; ≥ 20 fps.
- [x] **T-13 Skeleton overlay + debug panel** — draw skeleton on canvas, mirrored display, FPS and raw visibility values in debug panel.
      _AC:_ skeleton tracks the user smoothly and lines up with the body.

### Milestone 3 — Engine core (most important — test heavily)

- [x] **T-14 Geometry + pixel conversion** (§8.2, §8.3) with tests.
- [x] **T-15 Smoothing + visibility gate + side selection** (§8.4, §8.5) with tests.
- [x] **T-16 Generic rep state machine** (§8.6) supporting both directions, min/max rep time, partial-rep rejection, with tests.
- [x] **T-17 Scoring** (§8.8) with tests.
- [x] **T-18 Synthetic data generator** — test utility producing landmark sequences for given angle curves, frame rate, noise, and visibility drops.
- [x] **T-19 Analyzer** (§8.10) wiring everything together.
      _AC:_ all tests from §8.11 that don't depend on specific exercises pass.

### Milestone 4 — Exercises

- [x] **T-20 Squat definition** + tests from §8.11.
- [x] **T-21 Bicep curl definition** + tests.
- [x] **T-22 Shoulder press definition** + tests (including uneven press and wrists-above-nose rule).
- [x] **T-23 Live debug for tuning** — debug panel shows primary angle, metrics, state, and lets you adjust the active exercise's thresholds with sliders (in-memory only).
      _AC:_ doing each exercise in front of the camera: 10 clean reps counted as 10; 5 half reps counted as 0 with the correct cue; deliberate bad form triggers the correct error.

### Milestone 5 — Workout flow & persistence

- [x] **T-24 Home page** — user picker/creator, exercise cards from the API.
- [ ] **T-25 Workout page** — setup screen with visibility check, countdown, live counters, cue banner, angle gauge, finish button.
- [ ] **T-26 Persist session** — create session on start, POST each completed rep immediately (with retry queue), finish on end.
      _AC:_ reps appear in Adminer in real time while exercising; killing the backend for 5 s doesn't lose reps.
- [ ] **T-27 Voice & feedback** — spoken rep counts and cues with cooldowns (§8.9), mute toggle.
- [ ] **T-28 Summary page** — per §9.

### Milestone 6 — History & polish

- [ ] **T-29 History page** — sessions list + charts (Recharts) from stats endpoint.
- [ ] **T-30 Visual polish** — dark theme, large numbers, consistent spacing, loading and error states everywhere.
- [ ] **T-31 Demo data script** — `make demo-data` inserts a few realistic past sessions for `Demo User` so History charts look good during the presentation.
- [ ] **T-32 README & presentation script** — how to run, troubleshooting (camera permissions, lighting, distance, Docker on Mac/Windows), and a 5-minute demo walkthrough:
  1. Show architecture (`docker compose ps`, `/docs`).
  2. Squat set with one deliberate shallow rep and one leaning rep → app catches both.
  3. Open Adminer → show the reps just saved with their errors.
  4. Bicep curl with elbow swing → caught.
  5. History page with progress charts.
- [ ] **T-33 Final verification** — from a fresh clone: `make reset`, run all tests, perform each exercise end-to-end, confirm data in DB.

### Stretch (only if everything above is done)

- [ ] S-01 Rep-by-rep replay: store the primary-angle curve per rep (downsampled) in `metrics` and plot it on the Summary page.
- [ ] S-02 Personal calibration: user does 2 slow reps; thresholds adapt to their range of motion.
- [ ] S-03 Fourth exercise: lunge or lateral raise.
- [ ] S-04 Export session as PDF/CSV.

---

## 14. Troubleshooting knowledge for the agent

- **Angles look wrong / off by a lot** → coordinates not converted to pixel space (§8.2), or the
  mirrored display coordinates were used for math.
- **Reps counted while standing still** → smoothing missing, thresholds too close together, or
  `MIN_REP_MS` not enforced.
- **Rep never counted** → user not reaching the end threshold; check the debug panel's live angle and
  tune with sliders; also check the correct side is selected.
- **Low FPS** → use `pose_landmarker_lite.task` as a fallback option, make sure only one detection
  runs per frame, and don't re-render React on every frame (store per-frame data in refs and update
  UI state at ~10 Hz).
- **Camera not available inside Docker** → camera is accessed by the browser on the host, not by the
  container; just open `http://localhost:5180`.
- **"port is already allocated" / "address already in use"** → never take another port from the
  forbidden list in §5.1. Pick a new free port, update `.env`, and tell the developer which one.
