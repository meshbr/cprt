# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `README.md` first — it has the CMS schema, the full DOM contract and the
Webflow API gotchas. This file covers the working setup, the runtime
architecture, and where things currently stand.

---

## What this is

An interactive floor plan for CPRT's Webflow property pages: a floor dropdown,
an SVG floor plate with clickable unit hotspots, a unit dropdown, and a detail
panel. Two plain browser files, no build step, no framework.

```
src/floorplan.js    the whole tool — self-executing IIFE, no-ops without .fpx-section
src/floorplan.css   runtime styles + the plate's colour variables
loader.html         the snippet that lives in Webflow's site footer code
```

**Only `src/` is served.** jsDelivr publishes `@<SHA>/src/` and the dev server
serves `/src/`. Nothing outside `src/` is loaded at runtime, so a copy of either
file anywhere else is dead weight — edit `src/`.

**The repo is public, and deliberately thin.** Git tracks only `README.md`,
`.gitignore` and `src/`. `CLAUDE.md`, `loader.html`, `package.json` and
`vite.config.js` are intentionally left untracked and local. A fresh clone
therefore has no `package.json` — `npm run dev` needs those files brought over
by hand. Don't "fix" this by committing them.

The visual design lives in Webflow as classes (`.fpx-detail`, `.fpx-specs`, and
so on) so it stays editable in the Designer. Only what the script depends on is
in the CSS here. Keep that split.

---

## Commands

```bash
npm install
npm run dev          # Vite, serves src/ on http://localhost:5174 (strictPort, cors)
npm run preview      # rarely useful — there is no build output
```

There is **no build, no linter and no test suite**. `vite build` is not part of
the workflow; the files ship as-authored. Verification is manual, in the browser
against the published Webflow site:

```js
localStorage.setItem('cprt-fp-dev', 'true')   // load from localhost:5174
localStorage.removeItem('cprt-fp-dev')        // back to the CDN
```

Refresh and the live site runs your local files. Only your browser is affected.
Edits need a manual refresh — the script is a plain IIFE rather than an ES
module, so Vite's hot reload does not apply to it.

**Safari** is stricter than Chrome about `http://localhost` on an `https` page.
Develop in Chrome if it refuses to load.

Port 5174 is deliberate: 5173 belongs to the other CPRT build
(`addisongabriel/cprt`), so the two run side by side.

## Deploying

1. Commit and push to `meshbr/cprt` (jsDelivr serves straight from GitHub)
2. Copy the commit SHA into `loader.html`'s `SHA` constant in Webflow's site
   footer code
3. Publish the Webflow site

The SHA pin is deliberate: jsDelivr caches the branch→commit mapping for ~12h
and the purge API does not reset it, so `@main` serves stale code after a
deploy. See the comment in `loader.html`.

---

## Architecture

Everything is one `init()` inside an IIFE. It bails immediately if
`.fpx-section` is absent, so the script is safe to load site-wide.

**Data path.** Webflow's API cannot bind CMS values to `data-` attributes, so
values reach the script through hidden bound child elements addressed by DOM id
(`#fpx-f-slug`, `#u-sf`, …). `init()` walks the two Collection Lists once and
builds plain objects: a `floorBySlug` map and a flat `units` array. Nothing is
re-read from the DOM afterwards. The two Lumos dropdowns are told apart by
content — the floor one contains `#fpx-f-slug`, the unit one contains
`.fpx-data`. README's DOM contract is the authority on the ids.

**Lifecycle.** `showFloor(slug)` → `loadPlate(floor)` → `bindHotspots(svg)` →
`selectUnit(unit)` / `clearSelection()`. `showFloor` sets `currentFloor`,
relabels both dropdowns, shows/hides unit items by floor, and clears selection.
`loadPlate` fetches the SVG, parses it with `DOMParser`, and — because a slow
response can arrive after another floor was picked — drops the result if
`currentFloor` has changed since. `bindHotspots` matches each unit slug to a
shape and wires pointer, focus and keyboard handlers. Selection state lives in
two module-scope refs, `paintedShape` and `paintedLabel`, which are repainted
back before anything else is painted.

**Colour contract.** `readColors()` reads six CSS custom properties off
`.fpx-section` at init and hands the values to the painting functions. Those
variables are defined in `src/floorplan.css` and resolve to Webflow swatch
variables with hex fallbacks. Changing the palette means editing the CSS (or
overriding on `.fpx-section` in Webflow) — never the script.

**SVG post-processing** is where most of the code lives, all of it working
around Illustrator exports: `labelsClickThrough` (strip inline font/fill, pin
the computed font-size, apply `u-text-style-h6`), `reflowText` (drop per-glyph
`x`), `repaintBase` / `tintStructure` / `tintStrokes` / `tintLabels` (repaint
units, structure and outlines), `paint` (hover and selection, stashing the
original in `data-of`), `isLight` (leave near-white pictograms alone),
`findShape` (slug, then `_slug`, in `id` then `data-name`).

**Mobile (<768px).** The script injects the plate toggle at runtime using the
site's accordion classes, and the SVG (100–200 KB) is fetched only on first
open. The unit dropdown works without ever opening the plate.

**Cross-file invariant.** A new bound CMS field means touching three places:
the id in the Webflow Designer, the reader in `src/floorplan.js`, and the
hide-list in `src/floorplan.css` — a carrier missing from that selector list
renders visibly on the page. Keep README's DOM contract in step too.

---

## Conventions

**ES5-flavoured, on purpose.** `var`, function declarations,
`Array.prototype.forEach.call`, no modules, no transpile step. Match it.

**No hardcoded colours.** Everything comes from Webflow theme or swatch
variables, read at runtime from `.fpx-section`. The only literals are `var()`
fallbacks and the near-white test in `isLight()`, which reads the drawing's own
fills rather than choosing a colour.

**Illustrator fights you, and the script works around it.** Inline fills beat
stylesheets, so hover and selection repaint in JS. Font-size is a presentation
attribute that CSS classes override, so the original size is captured and
pinned inline. Glyphs are positioned individually, so per-glyph `x` is stripped
to let text reflow. Unit ids gain a leading underscore, so lookup tries both.
Don't "simplify" these — each is load-bearing.

**Webflow changes need the Designer or the MCP connector**, not this repo.
Collection lists inside component slots are not reachable through the API at
all.

---

## Where things stand

**Working on `/fp-test` (cprt.webflow.io):** floor switching across all seven
floors, unit hotspots, hover and selection, the unit dropdown filtered to the
current floor, the detail panel, the mobile plate toggle.

**Data on CPRT is complete for 525 Lafayette:** 1 property, 33 unit types with
images, 7 floors with SVGs, 85 units across floors 4–10.

**The Webflow side** is a component, `Section - Interactive Floor Plan`, with
properties for the two collection-list filters, the section title and intro
text. Dropping it on a property page and setting those is all a new property
needs — plus its own CMS data.

---

## Open items

- **Unit boundaries**: the drawings separate rooms with differing fills, not
  outlines. Strokes are now added rather than recoloured — worth checking it
  reads well across all seven floors.
- **Label fit**: `u-text-style-h6` adds letter-spacing, so long labels
  ("AMENITY ROOM", "ELEVATORS") may overflow their shapes. If so, either drop
  the letter-spacing for labels or scale the pinned font-size to ~90%.
- **Focus indicator**: the browser's ring is suppressed and the stroke
  widening alone was too quiet, so the script draws its own rect around the
  focused unit (`addFocusRing`). Its 8-unit offset overlaps neighbouring units
  slightly — drop `--fpx-focus-ring-offset` if that reads badly on the denser
  floors.
- **Utility classes**: several `fpx-` classes still carry bespoke typography
  and spacing that should move to Lumos utilities, after which the duplicated
  properties should come out of the Webflow classes.
- **Waiting on the client**: per-type PNGs for five unit types that currently
  share artwork; descriptions for penthouse units 1005–1008; floor plate SVGs
  for Americana, Onyx and One Eleven.
- **README is slightly stale**: it predates the Floors `display-name` field,
  the five plate colour variables, the stroke width settings, and the
  accordion-styled mobile toggle.
