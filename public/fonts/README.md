# Self-hosted brand fonts

The brand direction "Groove" (issue #15) pairs **Fraunces** (display) with
**Inter** (body). Both are self-hosted here as `.woff2` rather than loaded from a
font CDN, because the production CSP blocks external font hosts.

`src/styles/globals.css` declares `@font-face` for the files below. If a file
is ever missing, the rule resolves to nothing and the `--font-display` /
`--font-body` token stacks fall back gracefully (Fraunces → `ui-serif, Georgia,
…`; Inter → `ui-sans-serif, system-ui, …`), so the UI is never broken — it just
renders in the fallback faces.

## Vendored files

Both families are **OFL-licensed**. The files here are the **latin subset**
`.woff2` as served by the Google Fonts CSS2 API (English-only UI, so the latin
subset is sufficient). To refresh, re-fetch the `/* latin */` block from the
CSS URLs below with a modern-browser `User-Agent`, then download the `.woff2`.

| File                 | Family   | Weight | Subset | Source CSS (CSS2 API)                                               |
| -------------------- | -------- | ------ | ------ | ------------------------------------------------------------------ |
| `fraunces-600.woff2` | Fraunces | 600    | latin  | `family=Fraunces:opsz,wght@9..144,600` (v38)                       |
| `inter-400.woff2`    | Inter    | 400    | latin  | `family=Inter:wght@400` (v20)                                      |
| `inter-600.woff2`    | Inter    | 600    | latin  | `family=Inter:wght@600` (v20)                                      |

Licenses (SIL Open Font License 1.1):
Fraunces — https://fonts.google.com/specimen/Fraunces/license ·
Inter — https://fonts.google.com/specimen/Inter/license
