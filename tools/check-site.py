#!/usr/bin/env python3
"""Static sanity checks for the site — run by the Pages workflow before every deploy.

    python3 tools/check-site.py

Fails (exit 1) when something would break the live site:
  * a JS file (web app, service worker, or an inline <script> block) does not parse
  * app/index.html loads a script that is missing
  * a file listed in the service worker's SHELL is missing (the worker would never install)
  * anything but whitespace follows </html> (it shows up as stray text on the page)
  * the manifest is not valid JSON, or the APK download link is gone
  * the landing page contains letters that are neither Sinhala nor Latin (a stray line of
    another script once slipped into a Sinhala string and showed up as gibberish)
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
errors = []


def fail(msg):
    errors.append(msg)
    print("FAIL  " + msg)


def node_check(path, label=None):
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode:
        fail(f"{label or path} does not parse:\n{r.stderr.strip()[:800]}")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# 1. every JS file parses
for name in sorted(os.listdir("app")):
    if name.endswith(".js"):
        node_check(os.path.join("app", name))
node_check("sw.js")

# 2. pages: nothing after </html>, inline scripts parse, JSON-LD is valid
for page in ("index.html", "app/index.html"):
    html = read(page)
    markup = re.sub(r"(<script[^>]*>).*?(</script>)", r"\1\2", html, flags=re.S)   # ignore script bodies
    end = markup.find("</html>")
    if end < 0:
        fail(f"{page}: no </html>")
    elif markup[end + len("</html>"):].strip():
        fail(f"{page}: stray text after the first </html>: {markup[end + 7:end + 80].strip()!r}")
    for i, (attrs, body) in enumerate(re.findall(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", html, re.S)):
        if "ld+json" in attrs:
            try:
                json.loads(body)
            except ValueError as e:
                fail(f"{page}: JSON-LD block is not valid JSON ({e})")
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(body)
        node_check(f.name, f"{page} inline <script> #{i}")
        os.unlink(f.name)

# 3. every script the web app loads exists
for src in re.findall(r'<script[^>]*\bsrc="([^"]+)"', read("app/index.html")):
    if not re.match(r"^(https?:)?//", src) and not os.path.isfile(os.path.join("app", src)):
        fail(f"app/index.html loads {src} but app/{src} is missing")

# 4. every file the service worker precaches exists (one 404 and cache.addAll rejects)
sw = read("sw.js")
m = re.search(r"const SHELL = \[(.*?)\];", sw, re.S)
if not m:
    fail("sw.js: SHELL list not found")
else:
    for entry in re.findall(r'"([^"]+)"', m.group(1)):
        path = entry[2:] if entry.startswith("./") else entry
        target = os.path.join(path, "index.html") if path == "" or path.endswith("/") else path
        if not os.path.isfile(target):
            fail(f"sw.js SHELL lists {entry} but {target} is missing")

# 5. manifest + download link
try:
    json.loads(read("manifest.webmanifest"))
except ValueError as e:
    fail(f"manifest.webmanifest is not valid JSON ({e})")
if "releases/download" not in read("index.html"):
    fail("index.html: APK download link missing")

# 6. the landing page is English + Sinhala only
for n, line in enumerate(read("index.html").splitlines(), 1):
    odd = [c for c in line if unicodedata.category(c)[0] in "LM" and ord(c) > 0x24F
           and not 0x0D80 <= ord(c) <= 0x0DFF        # Sinhala
           and not 0x20D0 <= ord(c) <= 0x20FF        # combining marks for symbols (keycaps)
           and not 0xFE00 <= ord(c) <= 0xFE0F]       # emoji variation selectors
    if odd:
        fail(f"index.html:{n}: unexpected script in the text: {''.join(odd)[:40]!r} "
             f"({unicodedata.name(odd[0], '?')})")

if errors:
    print(f"\n{len(errors)} problem(s) — not deploying.")
    sys.exit(1)
print("site OK")
