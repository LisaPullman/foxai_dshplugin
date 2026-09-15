---
name: foxai-batch-imagegen
description: Batch-generate images from a vague idea via https://pic.foxai.edu.kg/ (free Cloudflare Workers AI text2img) and save them to the output directory with a JSON report. Use when the user wants to batch generate / 批量生成 images, describes a vague or fuzzy image idea (朦胧意向) to turn into multiple pictures, or mentions pic.foxai.edu.kg / foxai text2img.
---

# foxai Batch Image Generation

Turn a user's vague idea into N themed images saved in `output/`.

## API (verified, no auth required)

- `GET https://pic.foxai.edu.kg/api/models` — model list with capabilities.
- `POST https://pic.foxai.edu.kg/api/generate` — JSON body, returns **raw image bytes** (Content-Type image/jpeg or image/png).
- Body fields: `model`, `prompt`, `width`, `height`, `steps`, `guidance`, `seed` (nullable), `negativePrompt` (only for models whose capabilities.negativePrompt is true).
- Server clamps out-of-range params. Concurrency limit ~2 in flight; 429 must be retried with backoff (script already does).
- Recommended free default model: `flux-1-schnell` (JSON transport, jpeg, steps 1–8 default 4, seed supported, no negative prompt). FLUX.2 models use multipart transport — unsupported by the script.

## Workflow

1. **Optimize the idea into prompts.** Follow [references/prompt-optimization.md](references/prompt-optimization.md): concretize the subject → add a style anchor → scene/composition → lighting/color mood → 1–2 quality boosters. Write N distinct English prompts (25–45 words each) varying only style/scene/angle, keeping the theme fixed. If the idea is too vague to yield any concrete theme (no subject at all), ask the user for a keyword or example instead of guessing. Translate Chinese input to English.
2. **Generate — two modes:**
   - **Single command (fast path):** give the script a short English subject phrase; it auto-expands into varied optimized prompts via its built-in style×scene matrix:
     ```bash
     python3 "<path-to-this-skill>/scripts/generate.py" \
       --idea "a cute cartoon ninja turtle in a colored mask" --count 6 \
       --out output --model flux-1-schnell --verify
     ```
   - **Explicit prompts (full control):** write `output/prompts.json` (JSON array of `{"prompt": "...", "name": "01"}`; optional per-item `negative`, `seed`, `width`, `height`, `steps`), then:
     ```bash
     python3 "<path-to-this-skill>/scripts/generate.py" \
       --prompts-file output/prompts.json --out output \
       --model flux-1-schnell --concurrency 2 --verify
     ```
   Prefer explicit mode when the user wants precise art direction; prefer `--idea` for quick batches.
3. **Verify.** Always pass `--verify`: structural checks (format, size, md5 duplicate detection) run automatically; the script never overwrites old files (regenerated items get `-2` suffixes). Then the agent spot-checks 1–2 images against their prompts; if off-theme or `verify: fail`, redo only those items without redoing the batch:
   ```bash
   python3 scripts/generate.py --idea "<same idea>" --count 6 --out output --regenerate "01,03"
   ```
4. **Report results** from the script's JSON output (also saved as `output/report.json`): count, file paths, per-image prompt. Mention errors per image; failures never abort the batch.

## Defaults & knobs

- Count: `--count` (single-command mode, default 4) or number of prompts-file entries.
- `--width/--height 1024`, `--steps 4`, `--concurrency 2`, `--timeout 180`, `--seed` nullable.
- Exit codes: 0 = some images produced; 1 = none produced; 2 = site/model error.

## Failure handling

- Site unreachable / API shape changed → exit 2 with `ERROR:` on stderr; state this plainly in the report and do not fabricate images from another source without asking.
- HTTP errors are classified with friendly hints: 429 → concurrency/rate-limit (script auto-retries twice with backoff); quota/neuron messages → daily free quota exhausted, try tomorrow; 401/403 → access password or UA blocked.
- Individual image failures and verify failures are recorded per-image (`status: "error"` / `verify: "fail"`); rerun with `--regenerate` to redo only those.
