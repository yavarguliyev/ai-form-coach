"""Rep error codes the API accepts (CLAUDE.md §8.8).

Only codes that can appear on a COUNTED rep are stored. Partial-rep and no-extension codes
are live cues in the browser and never reach the backend.
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

# Which codes each exercise may report.
EXERCISE_ERROR_CODES: dict[str, frozenset[str]] = {
    "squat": frozenset({"SQUAT_TORSO_LEAN", "SQUAT_TOO_FAST"}),
    "bicep_curl": frozenset({"CURL_ELBOW_SWING", "CURL_TOO_FAST"}),
    "shoulder_press": frozenset({"PRESS_UNEVEN", "PRESS_TOO_FAST"}),
}

# Form errors make a rep "not good" regardless of score; "too fast" does not.
FORM_ERROR_CODES: frozenset[str] = frozenset(
    {"SQUAT_TORSO_LEAN", "CURL_ELBOW_SWING", "PRESS_UNEVEN"}
)

# A rep is "good" if score >= this and it has no form errors.
GOOD_REP_MIN_SCORE = 70
