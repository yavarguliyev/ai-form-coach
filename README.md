# FormCoach AI

A camera-based exercise coach that runs on your own computer. Stand in front of your webcam and
do **squats**, **bicep curls** or **shoulder presses** — the app tracks your body, counts only
clean reps, tells you (on screen) what to fix, and saves every workout.

Your video never leaves your computer: the body tracking runs inside the browser.

---

## 1. What you need (install once)

| What | Why | How to get it |
| --- | --- | --- |
| **Docker Desktop** | Runs the whole app (database, server, website) — nothing else to install | [Download for Mac / Windows](https://www.docker.com/products/docker-desktop/). **Linux:** [Docker Engine](https://docs.docker.com/engine/install/) + the Compose plugin |
| **Git** *(optional)* | To download the code | macOS: already installed (or run `xcode-select --install`). Windows: [Git for Windows](https://git-scm.com/download/win) — it also gives you **Git Bash**. Or skip Git and use **Code → Download ZIP** on GitHub |
| **A terminal with bash** | To run the start script | macOS / Linux: the built-in **Terminal**. Windows: **Git Bash** (comes with Git for Windows) or WSL |
| **Chrome or Edge + a webcam** | To use the app | A laptop's built-in camera is fine |

You do **not** need Python, Node.js, PostgreSQL, VS Code or any programming knowledge — everything
runs inside Docker. Give Docker about 5 GB of free disk space.

## 2. Start the app (3 steps)

1. **Get the code** and open a terminal in it:

   ```bash
   git clone https://github.com/yavarguliyev/ai-form-coach.git
   cd ai-form-coach
   ```

   (Downloaded the ZIP instead? Unzip it, then open a terminal inside the unzipped folder.)

2. **Open Docker Desktop** and wait until it says it is running.

3. **Run the start script:**

   ```bash
   bash infra/start.sh
   ```

The script checks everything, builds the app, waits until it is ready and opens
**http://localhost:5180** in your browser. The **first start takes a few minutes** (it downloads
about 1 GB); later starts take seconds. When the browser asks for the camera, click **Allow**.

## 3. Everyday commands

Run these from the project folder:

| I want to… | Command | My saved workouts |
| --- | --- | --- |
| Start the app | `bash infra/start.sh` | kept |
| Restart it (stuck, or after updating the code) | `bash infra/restart.sh` | kept |
| Remove it completely (containers, images, data) | `bash infra/remove.sh` | **deleted** (asks first) |
| Add 3 weeks of example workouts (for a demo) | `bash infra/demo-data.sh` | kept — only examples are added/replaced |
| Delete the example workouts | `bash infra/demo-data.sh --remove` | kept |

`remove.sh` only removes FormCoach's own Docker containers, network, volume and images. It never
touches other Docker projects, and it keeps a base image (like `postgres`) if another project uses it.

## 4. Using the app

1. On **Exercises**, pick who is training (or add a new person), then choose an exercise.
2. Stand where the camera can see you — **sideways** for squats and curls, **facing the camera**
   for the shoulder press. A checklist turns green when you're in position, then a 3-2-1
   countdown starts by itself.
3. Exercise. Reps that count show up in the big counter; mistakes and reps that don't count are
   shown on the video. Press **Finish set** when you're done.
4. **History** shows your past sets, progress charts and most common mistakes per exercise.

Tip: press **D** during a workout to open the debug panel (live angles and tuning sliders).

| Page | Address |
| --- | --- |
| The app | http://localhost:5180 — always use `localhost`, not your IP address (browsers only allow the camera there) |
| API documentation | http://localhost:8010/docs |
| Database viewer (Adminer) | http://localhost:8090 — System **PostgreSQL**, Server **db**, user / password / database **formcoach** |

## 5. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Docker is not installed` / `not running` | Install Docker Desktop (step 1) and start it. Wait for it to say *running*, then run the script again. |
| `A required port is busy` | Another program uses 5180, 8010, 55432 or 8090. Close it, or change the port in the `.env` file (created on first start) and run `bash infra/restart.sh`. |
| "Camera access is blocked" | Click the camera icon in the address bar → **Allow**. On macOS also check **System Settings → Privacy & Security → Camera** for your browser. Close other apps using the camera (Zoom, Teams…). |
| It doesn't count my reps | Read the message on the video — it says exactly what it can't see or what to do ("Turn sideways to the camera", "Step back — I can't see your knees"). Stand 2–3 m from the camera with your whole body (or both arms and your head for the press) in view. |
| It loses track of me | Light your body from the front (a window or lamp behind you makes you a silhouette), wear clothes that contrast with the background, and keep other people out of the frame. |
| Rep counted / not counted wrongly | Press **D** during a workout: the panel shows the live angle and has sliders to tune the thresholds for your body (changes are not saved). |
| Windows: Docker is very slow or won't start | In Docker Desktop → Settings → General, enable **Use the WSL 2 based engine**, and give Docker at least 4 GB of memory (Settings → Resources). |
| Windows: `bash: command not found` | Run the commands in **Git Bash**, not in Command Prompt or PowerShell. |
| Linux: `permission denied` from Docker | Run `sudo usermod -aG docker $USER`, log out and in again. |
| Anything else | `bash infra/restart.sh`. Still broken? `bash infra/remove.sh`, then `bash infra/start.sh` for a clean install (deletes saved workouts). |

---

## How it works

```
Browser (http://localhost:5180)
  webcam → MediaPipe Pose (33 body points, runs locally) → engine:
     smoothing → visibility check → joint angles → rep counter → form checks → score
  → screen + voice feedback
  → each counted rep is sent to the server
                    │  HTTP / JSON
                    ▼
Server (FastAPI, :8010)  →  PostgreSQL database  ←  Adminer viewer (:8090)
```

- **Video never leaves the computer.** Only numbers are saved: per rep its score, mistakes,
  angles and duration.
- **A rep only counts if it is complete.** Each exercise follows one joint angle (knee for
  squats, elbow for curls and presses). You must start in position, reach the target angle (e.g.
  knee at 100° or lower), and come back. Half reps, wobbles, bounces and anything the camera
  couldn't clearly see are not counted — and the app says why.
- **Score:** 100 per rep, −30 for a form mistake (chest dropping, elbow swinging, uneven arms),
  −15 for going too fast. A rep is "good" with a score of 70+ and no form mistake.
- **Nothing is lost if the server hiccups:** reps are queued in the browser and re-sent until
  saved.

## Presentation script (5 minutes)

**Before you present (10 minutes earlier)**

1. `bash infra/start.sh`, then `bash infra/demo-data.sh` so History has three weeks of progress.
2. Open three browser tabs: the app (http://localhost:5180), the API docs
   (http://localhost:8010/docs), and Adminer (http://localhost:8090) — log in once
   (System **PostgreSQL**, Server **db**, user / password / database **formcoach**).
3. Check the light and camera: open **Squat**, stand 2–3 m away sideways and confirm the
   checklist turns green. Press **D** and do two slow squats; if a normal squat already shows
   "Keep your chest up", raise **Max torso lean** a little.
4. Keep the sound on (voice cues are part of the demo) — or press **M** to mute.

**The demo**

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Terminal: `docker compose -p formcoach ps`, then the API docs tab | "Everything runs locally in four containers: the web app, an API, a PostgreSQL database and a database viewer. The camera video never leaves this laptop — pose detection runs in the browser." |
| 0:45 | App → **Squat** → stand sideways | "It first checks that it can see my whole body and that I'm side-on, then counts down." |
| 1:15 | Do 3 good squats, **1 half squat**, **1 squat leaning forward**, 1 good squat → **Finish set** | Point at the screen: the half squat says **"Not counted — Go lower"**, the leaning one is counted but flagged **"Keep your chest up"**, and you hear the rep numbers. |
| 2:15 | Summary page | "Every rep gets a score; it tells me my most common mistake and how to fix it." |
| 2:45 | Adminer → table **reps** → *Select data* (or the SQL below) | "Each rep was saved the moment I finished it — with its score, angles and the mistake code." |
| 3:30 | App → **Bicep Curl** → curl while **swinging the elbow forward** | It flags **"Keep your elbow pinned to your side"**. |
| 4:15 | **History** | "Over three weeks the average score went up and 'chest dropping forward' is the mistake to work on." |

SQL to paste in Adminer (*SQL command*) to show the latest reps:

```sql
SELECT e.name AS exercise, r.rep_index, r.score, r.errors, r.min_angle, r.max_angle, r.duration_ms
FROM reps r
JOIN sessions s ON s.id = r.session_id
JOIN exercises e ON e.id = s.exercise_id
ORDER BY s.started_at DESC, r.rep_index
LIMIT 20;
```

---

## For developers

The `Makefile` wraps the same Docker commands for day-to-day work:

```bash
make up          # check ports, build and start (detached)
make test        # error-code check + backend pytest + frontend vitest (inside the containers)
make logs        # follow logs
make down        # stop (data kept)
make reset       # wipe this project's database volume and start again
make seed        # re-run the idempotent seed
make demo-data   # 3 weeks of example sets for Demo User (re-run replaces only those)
```

Ports and passwords are configured in `.env` (created from `.env.example`). Host DB access:
`localhost:55432`.

## Progress

The project is built ticket by ticket; this list is updated after every ticket.

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

### Milestone 5 — Workout flow & persistence ✅

- [x] T-24 Home page — user picker/creator, exercise cards
- [x] T-25 Workout page — setup checklist, 3-2-1 countdown, live counters, banner, angle gauge
- [x] T-26 Persist session — reps saved live with a retry queue (survives a backend outage)
- [x] T-27 Voice & feedback — spoken rep counts and cues (3 s cooldown), "Great rep!", mute button (`M`)
- [x] T-28 Summary page — totals, per-rep table, most common mistake with a tip, delete

### Milestone 6 — History & polish ✅

- [x] T-29 History page — exercise tabs, stat tiles, score line + reps-per-set charts (Recharts), sets table, top mistakes
- [x] T-30 Visual polish — fits the screen while exercising, one friendly "server unreachable" notice that recovers by itself, 404 page, page titles, favicon
- [x] T-31 Demo data — `make demo-data` / `bash infra/demo-data.sh` (tagged example sets; real ones untouched)
- [x] T-32 README & presentation script — install guide, how it works, troubleshooting, 5-minute demo script
- [x] T-33 Final verification — fresh clone from GitHub → `start.sh` → `make reset` → all tests → every exercise end to end → data checked in the DB

### Stretch

- [ ] S-01 Rep-by-rep angle replay on the Summary page
- [ ] S-02 Personal calibration
- [ ] S-03 Fourth exercise
- [ ] S-04 Export session as PDF/CSV

**Tests:** `make test` — 64 backend + 214 frontend (engine, sync, voice) tests, plus the error-code check.

**Tooling:** `infra/start.sh`, `infra/restart.sh`, `infra/remove.sh` — one-command setup for non-developers.
