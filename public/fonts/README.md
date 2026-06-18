# Self-hosted brand fonts

The brand direction "Groove" (issue #15) pairs **Fraunces** (display) with
**Inter** (body). Both are self-hosted here as `.woff2` rather than loaded from a
font CDN, because the production CSP blocks external font hosts.

`src/styles/globals.css` declares `@font-face` for the files below. Until the
files are committed, the `@font-face` rules resolve to nothing and the
`--font-display` / `--font-body` token stacks fall back gracefully (Fraunces →
`ui-serif, Georgia, …`; Inter → `ui-sans-serif, system-ui, …`), so the UI is
never broken — it just renders in the fallback faces.

## Required files (follow-up — see PR for #15)

| File                | Family    | Weight | Source                                                     |
| ------------------- | --------- | ------ | ---------------------------------------------------------- |
| `fraunces-600.woff2`| Fraunces  | 600    | https://fonts.google.com/specimen/Fraunces (OFL)          |
| `inter-400.woff2`   | Inter     | 400    | https://fonts.google.com/specimen/Inter (OFL)             |
| `inter-600.woff2`   | Inter     | 600    | https://fonts.google.com/specimen/Inter (OFL)             |

Generate subset `.woff2` (e.g. with `fonttools` / `glyphhanger` for a latin
subset) and drop them in this directory. No code change is needed once the
filenames match the table above.
