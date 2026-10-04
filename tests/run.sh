#!/bin/bash
# Runs the browser tests against the real page in headless Microsoft Edge (Git Bash on Windows).
#
#   bash tests/run.sh          runs every *.test.js in this folder
#   bash tests/run.sh sort     runs only sort.test.js
#
# Each test script is loaded into a temporary copy of index.html straight after js/app.js, drives the app's own
# functions, and replaces the page with a PASS/FAIL report that is printed here. Nothing in the project is changed;
# the temporary page and browser profile go in tests/.tmp.

HERE="$(cd "$(dirname "$0")" && pwd -W)"
PROJECT="$(cd "$HERE/.." && pwd -W)"
TMP="$HERE/.tmp"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"

if [ ! -f "$EDGE" ]
then
    EDGE="/c/Program Files/Microsoft/Edge/Application/msedge.exe"
fi

mkdir -p "$TMP"
status=0

for script in "$HERE"/${1:-*}.test.js
do
    name="$(basename "$script" .test.js)"
    echo "== $name"

    python - "$PROJECT" "$script" "$TMP/$name.html" <<'EOF'
import io, sys
project, script, target = sys.argv[1:4]
html = io.open(project + '/index.html', encoding='utf-8').read()
tag = '<script src="js/app.js"></script>'
assert tag in html, 'index.html no longer loads js/app.js the way the test runner expects'
html = html.replace('<head>', '<head>\n<base href="file:///%s/">' % project, 1)
html = html.replace(tag, tag + '\n<script src="file:///%s"></script>' % script)
io.open(target, 'w', encoding='utf-8').write(html)
EOF

    report="$("$EDGE" --headless=new --disable-gpu --no-first-run --allow-file-access-from-files \
        --user-data-dir="$TMP/profile" --virtual-time-budget=120000 --dump-dom "file:///$TMP/$name.html" 2>/dev/null |
        PYTHONIOENCODING=utf-8 python -c "
import sys, re, html
page = sys.stdin.buffer.read().decode('utf-8', 'replace')
found = re.search(r'<pre id=.testout.>(.*?)</pre>', page, re.S)
print(html.unescape(found.group(1)) if found else 'NO REPORT - the page did not finish running the test')
")"

    echo "$report"

    if ! echo "$report" | tail -1 | grep -q "ALL PASSED"
    then
        status=1
    fi
done

exit $status
