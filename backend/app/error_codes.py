"""Rep error codes and miss reasons the API accepts (CLAUDE.md §8.8).

Every real rep ATTEMPT is stored — counted or not:
- a counted rep may carry form / tempo codes (RepErrorCode)
- a missed attempt (not counted) carries a miss reason and, for "too shallow" / "too fast",
  the matching code (MissErrorCode / the tempo code)
"""

from typing import Literal

RepErrorCode = Literal[
    "SQUAT_TORSO_LEAN",
    "SQUAT_TOO_FAST",
    "CURL_ELBOW_SWING",
    "CURL_TOO_FAST",
    "PRESS_UNEVEN",
    "PRESS_TOO_FAST",
]

# The end position was never reached (only on missed attempts).
MissErrorCode = Literal["SQUAT_SHALLOW", "CURL_PARTIAL", "PRESS_PARTIAL"]

# Why an attempt was not counted.
MissReason = Literal["partial", "too_short", "too_long", "lost_tracking"]

# lost_tracking is shown but never lowers the set score: it is a camera/setup problem.
UNSEEN_REASON = "lost_tracking"

# Codes a COUNTED rep of each exercise may carry.
EXERCISE_ERROR_CODES: dict[str, frozenset[str]] = {
    "squat": frozenset({"SQUAT_TORSO_LEAN", "SQUAT_TOO_FAST"}),
    "bicep_curl": frozenset({"CURL_ELBOW_SWING", "CURL_TOO_FAST"}),
    "shoulder_press": frozenset({"PRESS_UNEVEN", "PRESS_TOO_FAST"}),
}

# Codes a MISSED attempt of each exercise may carry (not deep enough / too fast).
EXERCISE_MISS_CODES: dict[str, frozenset[str]] = {
    "squat": frozenset({"SQUAT_SHALLOW", "SQUAT_TOO_FAST"}),
    "bicep_curl": frozenset({"CURL_PARTIAL", "CURL_TOO_FAST"}),
    "shoulder_press": frozenset({"PRESS_PARTIAL", "PRESS_TOO_FAST"}),
}

# Form errors make a rep "not good" regardless of score; "too fast" does not.
FORM_ERROR_CODES: frozenset[str] = frozenset(
    {"SQUAT_TORSO_LEAN", "CURL_ELBOW_SWING", "PRESS_UNEVEN"}
)

# A rep is "good" if score >= this and it has no form errors.
GOOD_REP_MIN_SCORE = 70
