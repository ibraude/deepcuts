# Spec — DeepCuts Website

**Date:** 2026-07-10
**Scope:** A single-page marketing website for the DeepCuts app. Beautiful, restrained, motion-forward. Reads all content live from the remote content catalog shipped in the previous spec. Deployed to Vercel.

## Goal

Deliver a design-award-worthy landing page at `deepcuts.vercel.app` (custom domain later) that:

- Explains what DeepCuts is in three sentences or fewer.
- Lets people download the signed `.dmg` from GitHub Releases.
- Shows the released **Library** with Bandcamp-style inline preview playback (first narration MP3 of each episode).
- Shows the **Coming soon** roster with expected release windows.
- Feels alive through deliberate, restrained motion.

## Non-goals

- No multi-page routing, blog, per-episode pages, or CMS.
- No podcast RSS, newsletter, or third-party syndication.
- No analytics, cookies, or community features.
- No server-side rendering; static build only.
- No custom domain setup in this spec (deferred).
- No visual regression testing infrastructure (Chromatic/Percy) — out of scope.

## Aesthetic direction

**Direction A — Gallery on Black.** Cohesive with the desktop app's UI language. The covers do all the color work; the page is quiet chrome around them.

**Palette**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0a` | Page background |
| `--surface` | `#141414` | Player drawer surface |
| `--ink` | `#f5f5f5` | Primary text |
| `--muted` | `#7a7a7a` | Labels, meta, secondary text |
| `--hairline` | `rgba(255,255,255,0.08)` | Borders, dividers |
| `--accent` | derived per-episode from `meta.json.palette.accent` | Progress bar + glow on the currently-playing card only |

Everything else stays greyscale. Per-episode accent is scoped to the playing card so the color reads as music.

**Type**

- **Display:** Inter Tight (weight 400, tight tracking, large sizes).
- **Body/labels:** Inter (weight 400/500).
- **No serifs.** Album covers already carry serif energy; adding a body serif fights them.

Scale: 12 (label caps) / 15 (body) / 17 (card title) / 24 (section heading) / 72 (hero desktop) / 44 (hero mobile).
Tracking: 0.22em on uppercase labels; 0 on body; −0.01em on hero headline.

**Spacing**

8px grid. Section vertical padding: 160px desktop / 96px mobile. Card gap: 32px desktop / 24px mobile. Max page width: 1280px, gutters 48px.

**Iconography**

Two SVG icons: play triangle, pause bars (12×14, `currentColor`, hand-authored paths). No icon library.

**Cover treatment**

Square, no rounding, no border, no shadow at rest. On hover: subtle cursor-follow tilt and soft elevation shadow (see Motion).

## Site structure

Single scrollable page, top to bottom.

1. **Header** (fixed, thin). Small `DEEPCUTS` wordmark upper-left; `Download for Mac` link upper-right. 60px tall, translucent black backdrop with a hairline bottom border.

2. **Hero.** One screen-height section. Left: 72px lightweight sans headline — *"Listening documentaries for music fans."* Below: tagline in Inter italic (still sans, no serifs anywhere on the site) — *"Deep albums. Real stories. Timeless music."* Below that: primary download button + a single line of requirements (*"macOS · requires Spotify"*). Right side: one large featured cover, tilted ~2°, or a subtle staggered stack of 3–4 covers. The featured cover is the most recently released episode (highest `order` where `status === 'released'`); if no episode is released yet, use the next-upcoming episode (lowest `order`, currently `almost-blue`).

3. **Library.** Section heading `LIBRARY` in 0.22em tracked caps. 3-column grid on desktop, 2-col tablet, 1-col mobile. Each card: cover + artist name (Inter medium) + album name (Inter muted) + a two-line blurb snippet from `meta.json.blurb` (already loaded). No duration on the card — duration lives in the manifest and the manifest is fetched only on-click. Click a cover → Bandcamp-style inline player drawer unfolds beneath (see Motion).

4. **Coming soon.** Section heading `COMING SOON`. Same grid; covers rendered at 80% opacity; no interaction. Expected-release date in tracked caps instead of duration.

5. **What it is.** Three short paragraphs stacked centered, ~640px max width. What DeepCuts is / how Spotify is involved / macOS-only note.

6. **Download** (secondary CTA). Centered `Get DeepCuts for Mac` button, version number + system requirements below, *"or run from source →"* link to the repo below that.

7. **Footer.** Thin. Copyright line, GitHub icon link, tiny colophon.

**Deep links.** Each released episode gets an anchor id (`#chet-baker-almost-blue`). Sharing a URL with the hash scrolls to and auto-opens that card. Cheap — no routing library needed.

**Responsive.** Hero cover collapses under the headline on <768px; grids stack to 1 column; player unfolds full-width. Minimum supported viewport: 375px.

## Motion

Motion earns its place. Slow, confident, editorial. No spring bounce, no gimmicks. Every animation adds presence.

**Global**

- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out). Standard duration 400–600ms. Interactive feedback under 200ms.
- Framework: **Framer Motion 11** for orchestrated sequences (hero reveal, staggered grids). Plain CSS for hover/state transitions and the player drawer.
- `prefers-reduced-motion` is respected globally. When set, all transforms become opacity-only (`0 → 1` fade, no scale/translate/blur), scroll-triggered reveals fire instantly, and the equalizer pauses.

**Hero arrival** (on page load)

- Headline reveals line-by-line: each line starts `y: 24px, opacity: 0, blur: 8px`, animates to `y: 0, opacity: 1, blur: 0` at 620ms with a 90ms stagger.
- Featured cover unblurs from `blur(20px) → blur(0)` and `scale(1.04) → 1` over 800ms starting 200ms after the headline lands.
- Download button fades in at 1100ms.
- Total choreography completes at ~1.4s.

**Scroll**

- Section labels (`LIBRARY`, `COMING SOON`) draw in via character-by-character opacity stagger (30ms/char); a hairline underline extends L→R (400ms after the last character lands).
- Cover cards fade + rise into view (`y: 16px → 0`, `opacity: 0 → 1`, 500ms) with a 60ms stagger via `IntersectionObserver` at 15% visibility. Once revealed, cards don't re-animate on re-scroll.
- A hairline vertical scroll-progress line pinned to the right edge tracks page depth. 1px wide, `--muted`.

**Cover hover** (pointer devices only)

- Cursor-follow 3D tilt: max ±2.5° rotation on X/Y, scale 1.02, `translateZ(0)`. 120ms damping transition.
- Soft new shadow: `0 24px 48px rgba(0,0,0,0.5)` at 200ms.
- Below-cover text lifts 2px.
- Touch devices: no tilt; static scale 1.02 on active tap.

**Cover click → player unfold**

- The cover itself doesn't move. Below it, a drawer expands from `height: 0` → measured `height: auto` over 380ms.
- Player controls (play button + progress bar + timestamps + blurb) fade in inside the drawer with 120ms delay.
- If another card is already playing, its drawer collapses in a coordinated 380ms sequence. Only one drawer open at a time.
- Progress bar animates via `requestAnimationFrame`.
- On play: soft accent-color glow at the base of the cover — `box-shadow: 0 0 60px -20px <accent>` at 40% opacity, fading in over 800ms.

**Playing equalizer**

- Beside the play button while playing: 4-bar equalizer, each bar oscillating sine-wave-style with staggered offsets (0.8–1.2s cycles). Pure CSS. Pauses on pause.

**Hero cover counter-parallax**

- On scroll, the hero featured cover drifts up at 5% of scroll velocity — `translateY(scrollY * 0.05)`. Barely perceptible. No other parallax anywhere.

**Download button**

- On hover: background lightens 8%, letter-spacing widens 0.05em → 0.08em over 200ms.
- On click: brief tap `scale 0.98 → 1`, then "opening…" state while the download URL resolves.

**Explicitly out**

- No text-scramble, no marquees, no auto-scrolling carousels.
- No 3D cover flipping, no card physics.
- No gradient cursors, no glow trails.
- No autoplay of audio.

## Tech & data flow

**Stack**

- `website/` folder in the deepcuts repo, self-contained (own `package.json`, `vite.config.ts`, `tsconfig.json`).
- Vite 5 + React 18 + TypeScript.
- `framer-motion@11` for orchestrated animation.
- `tailwindcss@4` for utility styling (matches the app's version).
- Zod for parsing catalog/meta responses (reuse schemas from `../src/shared/` via a `@shared` path alias).
- No routing library. Single page, hash-based deep links.

**Repo layout**

```
website/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  public/
    favicon.svg
    og-image.png                  # 1200x630 for social cards
  src/
    main.tsx
    App.tsx
    catalog/
      fetchCatalog.ts             # fetch + parse + memoize
      types.ts                    # re-exports from @shared
    components/
      Header.tsx
      Hero.tsx
      Library.tsx
      EpisodeCard.tsx
      InlinePlayer.tsx
      Equalizer.tsx
      Upcoming.tsx
      About.tsx
      Download.tsx
      Footer.tsx
      ScrollProgress.tsx
      RevealOnScroll.tsx          # <IntersectionObserver> wrapper
    hooks/
      useReducedMotion.ts
      usePlayer.ts                # single-player state
      usePointerTilt.ts           # cursor-follow 3D tilt
    lib/
      easing.ts
      formatDuration.ts
    styles/
      tokens.css
      base.css
```

**Sharing schemas.** `website/tsconfig.json` has `paths: { "@shared/*": ["../src/shared/*"] }`. Vite is configured with the same alias so imports like `import { remoteCatalogSchema } from '@shared/catalog'` work at build and runtime. One source of truth for `RemoteCatalogIndex`, `EpisodeMeta`, and `EpisodeManifest`.

**Data flow**

1. On page load, `fetchCatalog()` fetches `catalog.json` from the jsDelivr URL (`https://cdn.jsdelivr.net/gh/ibraude/deepcuts@main/content/catalog.json`), validates with `remoteCatalogSchema`.
2. In parallel, for each episode, fetch `episodes/<id>/meta.json` — validated with `episodeMetaSchema`.
3. Group into `released` and `upcoming` by status; sort by `order`.
4. Cover URLs constructed synchronously as `${BASE}/episodes/<id>/cover.png`.
5. Preview clip URL: for released episodes, fetch `episodes/<id>/manifest.json` **on demand** when the user clicks the cover. Extract `chapters[0].segments.find(s => s.type === 'narration' && s.audio)?.audio` and hand to the audio element.
6. Manifests are cached in an in-memory `Map<id, EpisodeManifest>` so re-clicks don't re-fetch.

**Player** (single-active). A tiny hook in `usePlayer.ts`:

```ts
type PlayerState = {
  activeId: string | null
  status: 'idle' | 'loading' | 'playing' | 'paused'
  currentTime: number
  duration: number
}
```

One shared `<audio>` element at the App root. Clicking a new card sets `activeId`, resets `currentTime`, calls `audio.load()` + `audio.play()`. `timeupdate` events feed `currentTime` for the progress bar. `ended` sets status to idle.

**Download CTA.** At build time, a Vite plugin fetches `https://api.github.com/repos/ibraude/deepcuts/releases/latest` and inlines the download URL + version string into the HTML at build. If the API fails or returns no `.dmg` asset, the CTA falls back to `https://github.com/ibraude/deepcuts/releases/latest` (which redirects to the newest release page). No client-side calls to GitHub — keeps the site static and rate-limit-free.

**Build & deploy**

- `cd website && npm run build` produces `website/dist/`.
- Vercel project connected to the `ibraude/deepcuts` repo. **Root Directory** project setting is `website/` (this is how Vercel handles monorepos). With that set, build command is just `npm ci && npm run build`; output directory is `dist`. Framework preset: Vite (autodetected).
- `main` branch deploys to production; PRs get preview URLs.
- Custom domain: deferred to a later spec.

## Testing

- **Vitest** unit tests for `fetchCatalog.ts` (validation + grouping + sorting), `usePlayer.ts` (state transitions), and `useReducedMotion.ts`. Fake `fetch` following the pattern in `src/main/catalog/RemoteCatalog.test.ts`.
- **Playwright** end-to-end smoke test (one spec):
  1. Catalog loads and displays released + upcoming sections.
  2. Clicking a released cover unfolds its player drawer.
  3. Clicking a different released cover collapses the first and opens the second.
  4. Setting `prefers-reduced-motion: reduce` disables transforms (assert absence of transform styles on cards).
- **Existing tests unchanged.** The website is a separate `npm` workspace/project; its `npm test` runs Vitest against `website/src/**/*.test.ts` only. The app's existing tests are untouched.
- `npm run typecheck && npm run test && npm run build` in `website/` all green.

## Definition of done

1. `website/` folder exists in the deepcuts repo as a self-contained Vite + React project sharing zod schemas from `../src/shared/` via `@shared` alias.
2. `fetchCatalog()` loads and validates `catalog.json` + all per-episode `meta.json` files from the jsDelivr URL. In-memory manifest cache.
3. Page sections implemented: Header, Hero, Library, Coming Soon, About, Download, Footer.
4. Direction A aesthetic: near-black background, Inter Tight display, Inter body, per-episode accent scoped to the playing card.
5. Motion choreography implemented per spec: hero arrival, section label reveal, card fade-rise, cover hover tilt, player drawer unfold, equalizer, scroll-progress line, hero counter-parallax. `prefers-reduced-motion` fully respected.
6. Player: single-active Bandcamp-style. Click a cover → drawer unfolds; only one active at a time. First narration MP3 from each manifest is the preview.
7. Download button: inlined at build time from the GitHub Releases API; graceful fallback to the releases page.
8. Deployed on Vercel with Root Directory set to `website/`; live at the auto-assigned `*.vercel.app` URL; PR previews working.
9. Vitest unit tests + one Playwright end-to-end smoke, all green.
10. `og-image.png` (1200×630) and `favicon.svg` shipped in `public/`.
11. Manual smoke on the deployed URL against the real jsDelivr catalog: catalog loads, at least one Library card plays inline, `prefers-reduced-motion` toggle disables transforms.

## Roster references

Consumes the 20 episodes seeded by the content catalog spec. Since all 20 are currently `status: upcoming` in `catalog.json`, the initial live site will show:

- **Library:** empty state (a single line: *"First episode drops soon. Get the app and be ready."*).
- **Coming soon:** 20 covers with their expected-release lines.

As episodes get published via `scripts/publish-episode.ts --status released`, they migrate from Coming Soon to Library with no site code changes. The site reflects catalog state on the next build (jsDelivr caches ~10 min).
