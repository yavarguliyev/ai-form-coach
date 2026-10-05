"""Fails if the frontend and backend disagree on which rep error codes exist.

frontend/src/engine/errorCodes.ts  REP_ERROR_CODES   (what the engine sends)
backend/app/error_codes.py         RepErrorCode      (what the API accepts)
"""

import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
ts = (root / "frontend/src/engine/errorCodes.ts").read_text()
py = (root / "backend/app/error_codes.py").read_text()

ts_block = re.search(r"REP_ERROR_CODES = \[(.*?)\] as const", ts, re.S)
py_block = re.search(r"RepErrorCode = Literal\[(.*?)\]", py, re.S)
if not ts_block or not py_block:
    sys.exit("check-codes: could not find the code lists (did a file change shape?)")

frontend = set(re.findall(r"'([A-Z_]+)'", ts_block.group(1)))
backend = set(re.findall(r'"([A-Z_]+)"', py_block.group(1)))
if frontend != backend:
    sys.exit(
        f"check-codes: MISMATCH\n  only in frontend: {sorted(frontend - backend)}\n"
        f"  only in backend:  {sorted(backend - frontend)}"
    )
# Codes stored on MISSED attempts ("end position not reached").
ts_miss = re.search(r"MISS_ERROR_CODES = \[(.*?)\] as const", ts, re.S)
py_miss = re.search(r"MissErrorCode = Literal\[(.*?)\]", py, re.S)
if not ts_miss or not py_miss:
    sys.exit("check-codes: could not find the miss code lists")
if set(re.findall(r"'([A-Z_]+)'", ts_miss.group(1))) != set(re.findall(r'"([A-Z_]+)"', py_miss.group(1))):
    sys.exit("check-codes: MISS codes differ between frontend and backend")

# The "good rep" rule (score >= 70 and no form errors) must classify codes the same way.
ts_form = re.search(r"FORM_ERROR_CODES: ReadonlySet<RepErrorCode> = new Set\(\[(.*?)\]\)", ts, re.S)
py_form = re.search(r"FORM_ERROR_CODES: frozenset\[str\] = frozenset\(\s*\{(.*?)\}", py, re.S)
ts_min = re.search(r"GOOD_REP_MIN_SCORE = (\d+)", (root / "frontend/src/engine/scoring.ts").read_text())
py_min = re.search(r"GOOD_REP_MIN_SCORE = (\d+)", py)
if not (ts_form and py_form and ts_min and py_min):
    sys.exit("check-codes: could not find FORM_ERROR_CODES / GOOD_REP_MIN_SCORE")
if set(re.findall(r"'([A-Z_]+)'", ts_form.group(1))) != set(re.findall(r'"([A-Z_]+)"', py_form.group(1))):
    sys.exit("check-codes: FORM_ERROR_CODES differ between frontend and backend")
if ts_min.group(1) != py_min.group(1):
    sys.exit(f"check-codes: GOOD_REP_MIN_SCORE differs ({ts_min.group(1)} vs {py_min.group(1)})")

print(
    f"check-codes: frontend and backend agree on {len(frontend)} rep error codes, miss codes, "
    f"form errors and GOOD_REP_MIN_SCORE={ts_min.group(1)}"
)
