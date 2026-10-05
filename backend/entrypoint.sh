#!/bin/sh
# Migrate → seed (idempotent) → serve. See CLAUDE.md §5.3.
set -e
alembic upgrade head
python -m app.seed
exec uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload --reload-dir app
