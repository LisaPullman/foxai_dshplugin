# Prompt Optimization Guide

Apply these rules when turning a vague idea (or a short subject like "一只卡通乌龟") into generation-ready English prompts.

## Optimization pipeline (per prompt)

1. **Subject concretization** — turn the fuzzy noun into a specific, drawable subject.
   Bad: "a turtle" → Good: "a chubby cartoon turtle with a glossy emerald shell and big friendly eyes"
2. **Style anchor** — always name an art style: e.g. `3D Pixar-style render`, `flat vector illustration`, `children's book watercolor`, `kawaii sticker art`, `cel-shaded anime`.
3. **Scene & composition** — where is the subject, from what camera angle? e.g. `wading through a shallow pond, low-angle shot`, `centered on a clean pastel background`.
4. **Lighting & color mood** — e.g. `soft morning light, warm pastel palette`, `bright saturated colors, high-key lighting`.
5. **Quality boosters** (sparingly, 1–2 per prompt) — `highly detailed`, `clean linework`, `professional illustration`.
6. **Negative shaping** — for models supporting negativePrompt, exclude common defects: `blurry, extra limbs, distorted, text, watermark, low quality`.

## Batch diversity rule

Across the N prompts in one batch, keep the user's theme fixed but vary **one or two axes only** (style, scene, camera angle, mood). Do NOT vary the subject itself — that breaks theme consistency.

Template per item:

```
[style anchor] of [concrete subject], [scene + composition], [lighting/color mood], [1-2 quality boosters]
```

## Example: "一只卡通乌龟" → 4 optimized prompts

- `3D Pixar-style render of a chubby cartoon turtle with a glossy emerald shell and big friendly eyes, wading through a shallow sparkling pond, soft morning light, warm pastel palette, highly detailed`
- `flat vector illustration of a cute cartoon turtle wearing a tiny red backpack, walking on a sandy path with small flowers, clean pastel background, minimal shapes, crisp linework`
- `children's book watercolor of a smiling baby cartoon turtle riding on a floating leaf, gentle ripples, dreamy soft lighting, delicate paper texture`
- `kawaii sticker art of a round cartoon turtle hugging a strawberry, sparkles around, bright saturated colors, thick outlines, centered composition`

## Anti-patterns

- Long run-on sentences stacking 6+ clauses — diffusion models dilute attention; keep 25–45 words.
- Contradictory terms (`photorealistic cartoon`) unless intentionally styled.
- Artist names (copyright) — use style descriptors instead.
- Chinese prompts: the site's models expect English; translate before submitting.
