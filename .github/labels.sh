#!/usr/bin/env bash
#
# Idempotent label sync for this repository.
#
# Usage:
#   ./.github/labels.sh                 # apply to the current repo (gh default)
#   ./.github/labels.sh owner/repo      # apply to a specific repo
#
# `gh label create --force` creates the label if missing and updates the
# colour/description in place otherwise, so re-running never duplicates labels.
set -euo pipefail

REPO_ARG=()
if [[ $# -ge 1 && -n "${1:-}" ]]; then
  REPO_ARG=(--repo "$1")
fi

label() {
  # $1 name  $2 colour (no #)  $3 description
  gh label create "$1" --color "$2" --description "$3" --force "${REPO_ARG[@]}"
}

# --- Type -------------------------------------------------------------------
label "bug"            "d73a4a" "Something isn't working"
label "enhancement"    "a2eeef" "New feature or request"
label "documentation"  "0075ca" "Improvements or additions to documentation"
label "question"       "d876e3" "Further information is requested"
label "duplicate"      "cfd3d7" "This issue or pull request already exists"
label "invalid"        "e4e669" "This doesn't seem right"
label "wontfix"        "ffffff" "This will not be worked on"

# --- Area (matches src/ structure) ------------------------------------------
label "area: agent"      "1d76db" "Core agent loop, memory, router, approvals"
label "area: interfaces" "1d76db" "CLI, Slack, Web, Voice interfaces"
label "area: tools"      "1d76db" "Tool registry and built-in tools"
label "area: scheduler"  "1d76db" "Cron-based mission scheduler"
label "area: plugins"    "1d76db" "Plugin system and plugin loading"
label "area: kanban"     "1d76db" "Kanban board feature"

# --- Workflow ---------------------------------------------------------------
label "triage"         "D93F0B" "Needs initial triage"
label "needs repro"    "E99695" "Needs a reproduction case"
label "security"       "B60205" "Security-sensitive issue or fix"
label "stale"          "EEEEEE" "Inactive; will be closed if no further activity"
label "pinned"         "006B75" "Exempt from stale automation"
label "dependencies"   "8957E5" "Pull requests that update a dependency file"

# --- Community --------------------------------------------------------------
label "good first issue" "7057ff" "Good for newcomers"
label "help wanted"      "008672" "Extra attention is needed"

echo "Labels synced."
