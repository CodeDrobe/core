# Doll Sister / 玩偶姐姐

An original Codex and WorkBuddy theme inspired by the user-provided composition reference. It uses two named theme images:

- `hero`: the home-page banner and polaroid artwork.
- `texture`: the sidebar, main surface, cards, and composer background.

Build and apply:

```bash
bun ./bin/codedrobe.mjs theme pack examples/doll-sister/theme.json \
  --output examples/doll-sister-1.0.0.codedrobe-theme --force
bun ./bin/codedrobe.mjs apply --app codex \
  --theme examples/doll-sister-1.0.0.codedrobe-theme --restart-existing
bun ./bin/codedrobe.mjs apply --app workbuddy \
  --theme examples/doll-sister-1.0.0.codedrobe-theme
```

## Asset generation

The assets were generated with OpenAI image generation on 2026-07-16. The supplied image was used only as a composition, wardrobe, motif, and palette reference. The generated artwork is original and contains no copied UI, typography, logos, or screenshot framing.

### Hero prompt

```text
Use case: stylized-concept
Asset type: wide desktop-app theme hero background
Primary request: Create an original premium "Doll Sister" visual inspired by the supplied reference image, for use behind a Codex desktop home screen.
Input images: Image 1 is a composition, wardrobe, subject, and palette reference only; do not reproduce its UI, typography, logos, or screenshot framing.
Scene/backdrop: a dreamy blush-pink bedroom studio with translucent curtains, soft cherry blossoms, floating petals, tiny pearlescent sparkles, ribbons, and subtle lavender gingham details.
Subject: one clearly adult East Asian woman with shoulder-length soft brown hair and wispy bangs, wearing a white face mask, cream knit cardigan, white blouse, and lavender plaid bow; seated naturally on the right third of the frame, friendly expressive eyes.
Style/medium: polished editorial photography with gentle dollhouse romanticism, realistic skin and fabric texture, refined rather than childish.
Composition/framing: wide 16:9 landscape; subject concentrated on the right 40 percent; generous clean low-contrast negative space across the left and center for interface text and cards; no important detail in the bottom 18 percent where the composer will sit.
Lighting/mood: luminous diffused morning light, soft bloom, delicate depth, calm and inspiring.
Color palette: ivory, shell pink, dusty rose, pale lavender, muted plum accents.
Constraints: image only; no text, no letters, no UI, no icons, no borders, no watermark; adult proportions; keep the center-left readable under dark plum text; avoid overexposure and preserve gentle contrast.
```

### Texture prompt

```text
Use case: stylized-concept
Asset type: subtle repeating desktop-app background texture
Primary request: Create an original seamless-looking romantic texture inspired by the supplied Doll Sister reference palette, for use behind sidebars, chat surfaces, and cards.
Input images: Image 1 is a color and motif reference only; do not reproduce its UI, person, text, logos, or screenshot.
Scene/backdrop: flat decorative surface combining extremely subtle lavender gingham, faint blush watercolor paper grain, sparse tiny cherry blossom petals, pearl dots, miniature ribbon linework, and delicate stitched borders.
Style/medium: refined Japanese stationery and couture fabric sample, premium and understated, low visual noise.
Composition/framing: square tile-like composition with balanced motifs and no focal center; edges should blend naturally when cropped or repeated.
Lighting/mood: soft matte finish, calm, airy, elegant.
Color palette: warm ivory, shell pink, dusty lavender, muted plum at very low opacity.
Constraints: no person, no text, no letters, no UI, no icons, no watermark; keep contrast low enough for dark text to remain readable; avoid large objects and avoid strong gradients.
```
