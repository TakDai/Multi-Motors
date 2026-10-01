#!/usr/bin/env bash
# One tool of the daily job: if it fails, the failure is recorded and the other tools still run;
# the run is marked failed at the end (after publishing what worked), so nothing fails silently.
"$@" && exit 0
code=$?
echo "- \`$*\` (code $code)" >> "${RUNNER_TEMP:-/tmp}/echecs.md"
echo "::warning::Échec de $* (code $code)"
exit 0
