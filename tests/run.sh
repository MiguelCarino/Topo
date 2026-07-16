#!/usr/bin/env bash
# Runs the suites in tests/suites against the real index.html in headless Chromium.
#
#   ./tests/run.sh            # everything
#   ./tests/run.sh wifi wave  # named suites only
#
# Each suite is injected into a copy of index.html and reports by appending a
# <pre id="TESTOUT"> of "PASS :: name" / "FAIL :: name" lines, which we read back
# out of the dumped DOM. The copy has to sit in the repo root: index.html pulls
# css/ and js/ by relative path, so running it from /tmp would silently load a
# page with no app on it and every assertion would fail for the wrong reason.
set -uo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-chromium-browser}"
RUNFILE=".testrun.html"
trap 'rm -f "$RUNFILE"' EXIT

command -v "$CHROME" >/dev/null || { echo "no $CHROME on PATH; set CHROME=..." >&2; exit 127; }

if [ $# -gt 0 ]; then
    suites=("$@")
else
    suites=()
    for f in tests/suites/*.js; do suites+=("$(basename "$f" .js)"); done
fi

total=0; failed=0; missing=0

for suite in "${suites[@]}"; do
    src="tests/suites/${suite}.js"
    if [ ! -f "$src" ]; then
        echo "?? ${suite}: no such suite" >&2; missing=$((missing + 1)); continue
    fi

    python3 - "$src" "$RUNFILE" <<'PY'
import sys
suite, runfile = sys.argv[1], sys.argv[2]
html = open('index.html').read()
tag = f'<script src="{suite}"></script>\n</body>'
if '</body>' not in html:
    sys.exit('index.html has no </body> to inject before')
open(runfile, 'w').write(html.replace('</body>', tag, 1))
PY

    dom=$("$CHROME" --headless --disable-gpu --no-sandbox \
          --virtual-time-budget=8000 --dump-dom "file://$PWD/$RUNFILE" 2>/dev/null)

    results=$(printf '%s' "$dom" | python3 -c '
import sys, re, html
dom = sys.stdin.read()
m = re.search(r"<pre id=\"TESTOUT\">(.*?)</pre>", dom, re.S)
print(html.unescape(m.group(1)).strip() if m else "")
')

    if [ -z "$results" ]; then
        echo "FAIL ${suite}: suite produced no output (crashed before reporting?)"
        failed=$((failed + 1)); continue
    fi

    n=$(printf '%s\n' "$results" | grep -c '^\(PASS\|FAIL\) ::')
    bad=$(printf '%s\n' "$results" | grep '^FAIL ::')
    total=$((total + n))

    if [ -n "$bad" ]; then
        nbad=$(printf '%s\n' "$bad" | wc -l)
        failed=$((failed + nbad))
        printf 'FAIL %-12s %d/%d\n' "$suite" "$((n - nbad))" "$n"
        printf '%s\n' "$bad" | sed 's/^/       /'
    else
        printf 'ok   %-12s %d\n' "$suite" "$n"
    fi
done

echo "---"
if [ "$failed" -eq 0 ] && [ "$missing" -eq 0 ]; then
    echo "$total assertions, all passing"
else
    echo "$total assertions, $failed failing${missing:+, $missing suite(s) missing}"
    exit 1
fi
