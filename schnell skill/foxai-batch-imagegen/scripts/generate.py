#!/usr/bin/env python3
"""Batch image generation via https://pic.foxai.edu.kg/ (Cloudflare Workers AI text2img).

Two modes:
  A) Single command (idea auto-expansion):
     python3 generate.py --idea "a cartoon ninja turtle" --count 6 [--out output] [opts]
  B) Explicit prompts file:
     python3 generate.py --prompts-file prompts.json [--out output] [opts]

Shared options:
  --model flux-1-schnell  --width 1024  --height 1024  --steps 4  --guidance 7.5
  --concurrency 2  --timeout 180
  --regenerate "01,03"      redo only these names (from an earlier report's prompts file)
  --verify                  structural check: valid image, size, and duplicate (md5) detection

Writes images to <out>/ and a report.json into <out/>. Existing files are never
overwritten. Failures are recorded per-image and never abort the batch.
Exit codes: 0 = at least one image produced; 1 = nothing produced; 2 = site/API error.
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://pic.foxai.edu.kg"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")  # Cloudflare blocks default urllib UA

# --- idea auto-expansion matrix (vary style x scene x angle, keep subject fixed) ---
EXPANSION_TEMPLATES = [
    ("3D Pixar-style render of {subject}, {scene1}, soft warm lighting, pastel palette, highly detailed"),
    ("flat vector illustration of {subject}, {scene2}, clean minimal background, crisp linework"),
    ("children's book watercolor of {subject}, {scene3}, dreamy soft lighting, delicate paper texture"),
    ("kawaii sticker art of {subject}, {scene4}, bright saturated colors, thick outlines, centered composition"),
    ("cel-shaded anime style of {subject}, {scene5}, dynamic low-angle shot, vivid colors, speed lines"),
    ("dramatic painted poster style of {subject}, {scene6}, cinematic composition, misty atmosphere"),
    ("cozy papercut collage style of {subject}, {scene7}, layered paper textures, warm afternoon glow"),
    ("retro comic book halftone style of {subject}, {scene8}, bold outlines, vintage dotted shading"),
]
SCENES = [
    "in a sunny meadow", "on a city street at night", "by a quiet lake at dawn",
    "surrounded by sparkles and stars", "leaping between rooftops under the moon",
    "standing back-to-back in a heroic pose", "napping under a tiny umbrella",
    "enjoying a snack in a cozy hideout",
]


def expand_idea(idea, count):
    """Expand a short English subject phrase into `count` varied, optimized prompts."""
    idea = idea.strip().rstrip(".")
    jobs = []
    for i in range(count):
        style_tpl = EXPANSION_TEMPLATES[i % len(EXPANSION_TEMPLATES)]
        # rotate scene pools so prompts differ even when count > len(templates)
        filler = {f"scene{n}": SCENES[(i + n - 1) % len(SCENES)] for n in range(1, 9)}
        prompt = style_tpl.format(subject=idea, **filler)
        jobs.append({"name": f"{i + 1:02d}", "prompt": prompt})
    return jobs


def classify_http_error(e):
    """Map HTTP errors to human-friendly hints (quota / rate limit / auth / other)."""
    code = e.code
    body = b""
    try:
        body = e.read()[:300]
    except Exception:
        pass
    text = body.decode("utf-8", "replace").lower()
    if code == 429:
        return ("HTTP 429 rate-limited by Cloudflare AI (concurrency/quota). "
                "Free tier allows only 2 images in flight and 10,000 neurons/day; "
                "retry later or reduce --count.")
    if code in (401, 403):
        return (f"HTTP {code}: access denied — the deployment may have enabled an access "
                f"password, or the request UA was blocked. Body: {text[:150]}")
    if "quota" in text or "exceeded" in text or "neuron" in text or code == 402:
        return ("daily free quota exhausted (Cloudflare Workers AI 10,000 neurons/day, "
                "resets automatically) — try again tomorrow or deploy your own instance")
    return f"HTTP {code}: {text[:150] or 'no body'}"


def fetch_models():
    req = urllib.request.Request(BASE + "/api/models", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def generate_one(model_caps, params, timeout):
    """POST /api/generate. Returns (bytes, ext)."""
    transport = model_caps.get("capabilities", {}).get("transport", "json")
    if transport == "multipart":
        raise RuntimeError(
            "model %s uses multipart transport which this script does not "
            "support; pick a JSON-transport model (e.g. flux-1-schnell)" % model_caps["id"]
        )
    data = json.dumps(params).encode()
    req = urllib.request.Request(
        BASE + "/api/generate",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        ctype = r.headers.get("Content-Type", "")
    if ctype.startswith("application/json"):
        payload = json.loads(body)
        img = payload.get("image") or payload.get("data") or payload.get("result")
        if not img:
            raise RuntimeError("unexpected JSON response: %s" % str(payload)[:200])
        import base64
        body = base64.b64decode(img)
    ext = "png" if body[:8] == b"\x89PNG\r\n\x1a\n" else (
        "webp" if body[:4] == b"RIFF" else "jpg")
    return body, ext


def unique_path(out_dir, name, ext):
    p = out_dir / f"{name}.{ext}"
    i = 2
    while p.exists():
        p = out_dir / f"{name}-{i}.{ext}"
        i += 1
    return p


def structural_verify(results):
    """Structural post-checks: decodable magic bytes, sane size, duplicate detection."""
    seen = {}
    for r in results:
        if r["status"] != "ok":
            continue
        p = Path(r["file"])
        body = p.read_bytes()
        issues = []
        if not (body[:3] == b"\xff\xd8\xff" or body[:8] == b"\x89PNG\r\n\x1a\n"
                or body[:4] == b"RIFF"):
            issues.append("unrecognized image format")
        if len(body) < 15_000:
            issues.append("suspiciously small file (likely blank/broken)")
        digest = hashlib.md5(body).hexdigest()
        if digest in seen:
            issues.append(f"exact duplicate of {seen[digest]}")
        else:
            seen[digest] = p.name
        r["verify"] = "pass" if not issues else "fail: " + "; ".join(issues)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idea", help="short English subject phrase; auto-expands into prompts")
    ap.add_argument("--count", type=int, default=4)
    ap.add_argument("--prompts-file")
    ap.add_argument("--out", default="output")
    ap.add_argument("--model", default="flux-1-schnell")
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--guidance", type=float, default=7.5)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--regenerate", help='comma-separated names to redo, e.g. "01,03"')
    ap.add_argument("--verify", action="store_true",
                    help="structural checks: format, size, duplicate detection")
    args = ap.parse_args()

    if not args.idea and not args.prompts_file:
        ap.error("provide --idea (single command) or --prompts-file")

    if args.idea:
        jobs = expand_idea(args.idea, args.count)
    else:
        jobs = json.loads(Path(args.prompts_file).read_text(encoding="utf-8"))

    if args.regenerate:
        keep = {n.strip() for n in args.regenerate.split(",") if n.strip()}
        jobs = [j for j in jobs if j.get("name") in keep]
        if not jobs:
            print(f"ERROR: --regenerate names {keep} not found in prompts", file=sys.stderr)
            sys.exit(2)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        models = {m["id"]: m for m in fetch_models()}
        model_caps = models.get(args.model)
        if model_caps is None:
            print(f"ERROR: model '{args.model}' not on server; available: "
                  + ", ".join(models), file=sys.stderr)
            sys.exit(2)
    except urllib.error.HTTPError as e:
        print(f"ERROR: site returned {classify_http_error(e)}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"ERROR: site unreachable ({e}); site down or API changed", file=sys.stderr)
        sys.exit(2)

    caps = model_caps.get("capabilities", {})
    steps_cfg = caps.get("steps") or {}
    guidance_cfg = caps.get("guidance") or {}
    size_cfg = caps.get("size") or {}

    def clamp(v, cfg, default):
        if not cfg or v is None:
            return default if v is None else v
        return max(cfg["min"], min(cfg["max"], v))

    def run(idx, job):
        name = job.get("name") or f"{idx + 1:02d}"
        params = {
            "model": args.model,
            "prompt": job["prompt"],
            "width": clamp(job.get("width", args.width), size_cfg, args.width),
            "height": clamp(job.get("height", args.height), size_cfg, args.height),
            "steps": clamp(job.get("steps", args.steps), steps_cfg, args.steps),
            "seed": job.get("seed", args.seed),
        }
        if caps.get("negativePrompt"):
            params["negativePrompt"] = job.get("negative", "")
        if caps.get("guidance"):
            params["guidance"] = clamp(job.get("guidance", args.guidance),
                                       guidance_cfg, args.guidance)
        last_err = None
        for attempt in range(3):  # 429 exponential backoff, max 2 retries
            try:
                body, ext = generate_one(model_caps, params, args.timeout)
                p = unique_path(out_dir, name, ext)
                p.write_bytes(body)
                return {"name": name, "file": str(p), "prompt": job["prompt"],
                        "seed": params.get("seed"), "status": "ok"}
            except urllib.error.HTTPError as e:
                last_err = classify_http_error(e)
                if e.code == 429 and attempt < 2:
                    time.sleep(2 ** attempt * 2)
                    continue
                break
            except Exception as e:
                last_err = str(e)[:200]
                break
        return {"name": name, "file": None, "prompt": job["prompt"],
                "status": "error", "error": last_err}

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        results = list(pool.map(lambda t: run(*t), enumerate(jobs)))

    if args.verify:
        results = structural_verify(results)

    ok = [r for r in results if r["status"] == "ok"]
    report = {
        "site": BASE,
        "model": args.model,
        "idea": args.idea,
        "requested": len(results),
        "succeeded": len(ok),
        "failed": len(results) - len(ok),
        "output_dir": str(out_dir),
        "images": results,
        "hint": ("verify failures / errors: rerun with --regenerate and the same "
                 "--idea or --prompts-file to redo only those items") if len(ok) < len(results) else None,
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
