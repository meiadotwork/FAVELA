"""Fold the whole game into one self-contained HTML file.

The game normally runs as ES modules that fetch an asset manifest, which needs
a web server. This bundles it instead: the modules are concatenated, the CSS is
inlined, and every atlas and prop becomes a data URI, so the result opens from
the filesystem and works anywhere a page can be hosted.

Modules keep their own scope. Each is wrapped in a function and publishes what
it exported to one shared namespace, which imports then destructure -- so two
modules that both declare `ctx` at the top level still cannot collide, and no
renaming is needed anywhere.

Usage: python3 tools/bundle.py [out.html] [--quality N]
"""
import base64
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dependency order: a module may only import from those already loaded.
MODULES = ['assets', 'tuning', 'world', 'actor', 'combat', 'ai', 'fx', 'input', 'audio',
           'render', 'hud', 'debug', 'game']

MIME = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg'}

IMPORT_RE = re.compile(r"^import\s*\{(.*?)\}\s*from\s*'[^']+';\s*$", re.M | re.S)
EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)', re.M)


def module_source(name):
    """Rewrite one ES module into a plain function body over a namespace."""
    src = open(os.path.join(ROOT, 'src', f'{name}.js')).read()
    exported = EXPORT_RE.findall(src)

    src = IMPORT_RE.sub(lambda m: f'const {{{" ".join(m.group(1).split())}}} = __M;', src)
    src = re.sub(r'^export\s+', '', src, flags=re.M)

    publish = f'Object.assign(__M, {{ {", ".join(exported)} }});' if exported else ''
    return f'// ---- src/{name}.js\n(function () {{\n{src}\n{publish}\n}})();\n'


def data_uri(path, quality=None):
    """Encode a file as a data URI, optionally re-compressing images smaller."""
    ext = os.path.splitext(path)[1].lower()
    raw = open(path, 'rb').read()
    if quality and ext == '.webp':
        from PIL import Image
        buf = io.BytesIO()
        Image.open(io.BytesIO(raw)).save(buf, 'WEBP', quality=quality, method=5)
        if buf.tell() < len(raw):
            raw = buf.getvalue()
    return f'data:{MIME.get(ext, "application/octet-stream")};base64,' \
           + base64.b64encode(raw).decode('ascii')


def collect_assets(quality=None):
    """The manifest, plus every file it names, as data URIs keyed by path."""
    base = os.path.join(ROOT, 'assets')
    manifest = json.load(open(os.path.join(base, 'assets.json')))

    wanted = [c['sheet'] for c in manifest['characters'].values()]
    wanted += [b['file'] for b in manifest['buildings']]
    wanted += [w['file'] for w in manifest.get('walls', [])]
    wanted += [c['file'] for c in manifest.get('cars', [])]
    if manifest.get('caveirao'):
        wanted.append(manifest['caveirao']['file'])
    for frames in manifest.get('fx', {}).values():
        wanted += [f['file'] for f in frames]
    if manifest.get('civilians'):
        wanted.append(manifest['civilians']['sheet'])

    files = {}
    for rel in dict.fromkeys(wanted):
        files[rel] = data_uri(os.path.join(base, rel), quality)
    return manifest, files


def build(out_path, quality=None):
    manifest, files = collect_assets(quality)
    css = open(os.path.join(ROOT, 'style.css')).read()

    # The loader reads from the inlined table instead of the network.
    code = []
    for name in MODULES:
        src = module_source(name)
        if name == 'assets':
            src = src.replace(
                "const manifest = await (await fetch(`${base}/assets.json`)).json();",
                'const manifest = window.__BUNDLED.manifest;')
            src = src.replace(
                '    img.src = src;',
                '    img.src = window.__BUNDLED.files[src.replace(/^assets\\//, "")] || src;')
        code.append(src)

    payload = json.dumps({'manifest': manifest, 'files': files}, separators=(',', ':'))

    # Without an explicit charset a file:// page is read as windows-1252 and
    # every accent in the Portuguese HUD turns to mojibake.
    html = f"""<meta charset="utf-8">
<title>FAVELA</title>
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover">
<style>
{css}</style>

<div id="stage">
  <canvas id="game" width="1280" height="720"></canvas>
  <div id="boot"><span>CARREGANDO</span><div id="bar"><i></i></div></div>
</div>

<script id="payload" type="application/json">{payload}</script>
<script>
window.__BUNDLED = JSON.parse(document.getElementById('payload').textContent);
const __M = {{}};
{''.join(code)}
</script>
"""

    with open(out_path, 'w') as f:
        f.write(html)
    mb = os.path.getsize(out_path) / 1e6
    print(f'wrote {out_path}  {mb:.1f} MB  ({len(files)} assets inlined)')
    return out_path


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    q = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--quality=')), None)
    build(args[0] if args else os.path.join(ROOT, 'dist', 'favela.html'), q)
