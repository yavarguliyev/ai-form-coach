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
