# FormCoach AI — all commands are scoped to the `formcoach` compose project only.
# Never add prune / global docker commands here (see CLAUDE.md §5.2).

SHELL := /bin/bash

# Load .env (create it from .env.example on first run)
ifeq (,$(wildcard .env))
$(shell cp .env.example .env)
endif
include .env
export

FRONTEND_PORT ?= 5180
BACKEND_PORT  ?= 8010
DB_HOST_PORT  ?= 55432
ADMINER_PORT  ?= 8090

COMPOSE := docker compose -p formcoach

.PHONY: help check-ports check-codes up down logs test seed reset ps

help:
	@echo "make check-ports  verify $(FRONTEND_PORT), $(BACKEND_PORT), $(DB_HOST_PORT), $(ADMINER_PORT) are free"
	@echo "make up           check-ports, then build and start the stack"
	@echo "make down         stop the stack"
	@echo "make logs         follow logs"
	@echo "make ps           list this project's containers"
	@echo "make test         check-codes, then backend pytest + frontend vitest inside containers"
	@echo "make seed         re-run the idempotent seed"
	@echo "make reset        wipe ONLY this project's DB volume, then up"

# Fails if any of our 4 host ports is taken by something other than this stack.
# If the formcoach stack is already running, its own ports are expected to be busy.
check-ports:
	@if [ -n "$$($(COMPOSE) ps -q 2>/dev/null)" ]; then \
		echo "formcoach stack is already running — ports in use by it are expected:"; \
		$(COMPOSE) ps --format '  {{.Name}}  {{.Ports}}'; \
		exit 0; \
	fi; \
	busy=0; \
	for entry in "frontend:$(FRONTEND_PORT)" "backend:$(BACKEND_PORT)" "db:$(DB_HOST_PORT)" "adminer:$(ADMINER_PORT)"; do \
		name=$${entry%%:*}; port=$${entry##*:}; \
		if lsof -nP -iTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; then \
			proc=$$(lsof +c 0 -nP -iTCP:$$port -sTCP:LISTEN | awk 'NR==2 {print $$1" (pid "$$2")"}'); \
			echo "  BUSY  $$port  ($$name) — used by $$proc"; busy=1; \
		else \
			echo "  free  $$port  ($$name)"; \
		fi; \
	done; \
	if [ $$busy -ne 0 ]; then \
		echo ""; \
		echo "ERROR: a required port is busy. Pick a new free port (not on the forbidden list in CLAUDE.md §5.1),"; \
		echo "set it in .env, and try again."; \
		exit 1; \
	fi; \
	echo "All ports free."

up: check-ports
	$(COMPOSE) up --build -d
	@echo ""
	@echo "App:     http://localhost:$(FRONTEND_PORT)"
	@echo "API:     http://localhost:$(BACKEND_PORT)/docs"
	@echo "Adminer: http://localhost:$(ADMINER_PORT)  (server: db, user/pass/db: $(POSTGRES_USER))"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

test: check-codes
	$(COMPOSE) exec -T backend pytest -q
	$(COMPOSE) exec -T frontend npm test

# Frontend engine and backend API must agree on the rep error codes.
check-codes:
	@python3 scripts/check_error_codes.py

seed:
	$(COMPOSE) exec -T backend python -m app.seed

# down -v removes only volumes declared by this compose project (fc_pgdata).
reset:
	$(COMPOSE) down -v
	$(MAKE) up
