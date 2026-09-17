# CPRT — Interactive Floor Plan

A Webflow floor plan tool: pick a floor, see its plate as an inline SVG, click a
unit to see its specs. Built for CPRT but not CPRT-specific — the script knows
nothing about any particular property. Reproduce the DOM contract below on any
Webflow site and it works.

Live reference: `cprt.webflow.io` — the 525 Lafayette property page.

---

## Install

Both files are plain browser assets. No build step.

**Footer custom code** (site-wide — the script no-ops on pages without the tool):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/meshbr/cprt@<SHA>/src/floorplan.css">
<script defer src="https://cdn.jsdelivr.net/gh/meshbr/cprt@<SHA>/src/floorplan.js"></script>
```

**Pin to a commit SHA, not `@main`.** jsDelivr caches the branch→commit mapping
for around 12 hours and the purge API does not reset it, so `@main` will serve
stale code after a deploy with no obvious way to force it. Bump the SHA every
time. (This bit the existing CPRT custom code; the warning is in its head tag.)

---

## CMS schema

Four collections. Field slugs matter — the bindings reference them.

### Interactive Properties
| Field | Type | Notes |
|---|---|---|
| `name`, `slug` | PlainText | |
| `availability-url` | Link | Property-wide leasing link, used by the CTA |
| `page-path` | PlainText | Which static page this property belongs to |

### Interactive Floors
| Field | Type | Notes |
|---|---|---|
| `name`, `slug` | PlainText | |
| `interactive-property` | Reference → Properties | |
| `floor-number` | Number (integer) | Dropdown sort order |
| `floor-plate-svg` | File | The SVG. Its path ids must match unit slugs |
| `featured` | Switch | Floor shown on load |

### Interactive Unit Types
| Field | Type | Notes |
|---|---|---|
| `name`, `slug` | PlainText | |
| `type-label` | PlainText | Visitor-facing, e.g. "One Bedroom + Den" |
| `bedrooms`, `bathrooms` | Number — **decimal** | Must be decimal; half-baths exist |
| `square-feet` | Number (integer) | |
| `floor-plan-image` | Image | Shared by every unit of the type |

### Interactive Units
| Field | Type | Notes |
|---|---|---|
| `name`, `slug` | PlainText | **Slug must match the SVG path id** |
| `display-name` | PlainText | e.g. "Unit 403" |
| `unit-number` | Number | |
| `floor` | Reference → Floors | |
| `unit-type` | Reference → Unit Types | |
| `interactive-property` | Reference → Properties | Required — see below |
| `description` | PlainText | |

**Why Units needs a property reference.** Collection List filters on a reference
field support only `equals` / `doesNotEqual` — there is no "is one of". Without
a direct property field the units list can only be scoped to a single floor,
which breaks floor switching. Collection Lists also cap at **100 items**, so an
unfiltered list stops working as soon as a second property exists.

---

## DOM contract

The script finds everything by DOM id inside `.fpx-section`. Webflow's API
cannot bind CMS values to `data-` attributes — both were rejected — so values
reach the script through hidden bound child elements instead.

```
.fpx-section                    ← script scopes everything to this
├── .fpx-head
│   ├── [heading / intro copy]
│   ├── Lumos Dropdown          ← floors
│   │   └── Collection List → Floors   [filter: property; sort: floor-number asc]
│   │       └── item
│   │           ├── a   #fpx-f-link      → Floor name (visible)
│   │           ├── div #fpx-f-name      → Floor name
│   │           ├── div #fpx-f-slug      → Floor slug
│   │           ├── div #fpx-f-num       → Floor number
│   │           ├── a   #fpx-f-svg       → href = floor-plate-svg
│   │           └── div #fpx-f-featured  → visibility bound to `featured`
│   └── Lumos Dropdown          ← units
│       └── .fpx-data  Collection List → Units   [filter: property]
│           └── item
│               ├── a   #fpx-u-link  → unit-number (visible)
│               ├── div #u-slug      → Unit slug
│               ├── div #u-floor     → floor → slug
│               ├── div #u-name      → display-name
│               ├── div #u-desc      → description
│               ├── div #u-type      → unit-type → type-label
│               ├── div #u-bd        → unit-type → bedrooms
│               ├── div #u-ba        → unit-type → bathrooms
│               ├── div #u-sf        → unit-type → square-feet
│               ├── img #u-img       → unit-type → floor-plan-image
│               └── a   #u-url       → property → availability-url
└── .fpx-body
    ├── .fpx-plate #fpxPlate         ← SVG injected here
    └── .fpx-detail
        ├── .fpx-empty #fpxEmpty
        └── #fpxBody
            ├── #fpxClose, #fpxName, #fpxType
            ├── #fpxBd, #fpxBa, #fpxSf
            ├── img.fpx-plan #fpxImg
            ├── #fpxDesc
            └── a #fpxCta
```

Both Collection Lists must sit **inside** `.fpx-section`. The two dropdowns are
told apart by content: the floor one contains `#fpx-f-slug`, the unit one
contains `.fpx-data`.

---

## SVG requirements

Export one SVG per floor with each unit as a group whose id is the unit slug.

**Illustrator prefixes an underscore** when an id would otherwise start with a
digit, so `525-unit-400` exports as `_525-unit-400`. The script tries the plain
slug, then the underscored form, in both `id` and `data-name`. **Do not edit the
SVGs** — they import as exported.

**Units must be filled.** SVG only registers pointer events where there is a
fill, so an outline-only shape will not respond to clicks.

**Labels go in their own group.** The script sets `pointer-events: none` on all
`<text>`/`<tspan>` and on any group whose id contains "label", so clicks on a
unit number reach the unit beneath it.

---

## Gotchas

Things that cost real time, recorded so they don't have to again.

**Bindings cannot be set at element creation.** `textContent` is rejected on
`DivBlock`, `TextBlock` and `DOM` alike. Create the element, then bind it in a
second call — and the setting key is `text`, not `textContent`.

**Nested reference fields use `<referenceFieldId>:::<targetFieldId>`** with the
*parent* collection's id. Passing the referenced collection's id directly fails
with "CMS field not found". `get_bindable_sources` is the only way to discover
these.

**Number fields are always created as integers.** The API takes no precision
argument and cannot change one afterwards, so decimals must be set by hand in
the Designer. Bedrooms and bathrooms need this.

**Decimal fields render "1.0".** `tidyNumber()` trims the trailing zero while
leaving "1.5" alone.

**Image fields accept a URL.** Passing `{"url": "..."}` makes Webflow fetch and
rehost server-side — no download needed, and identical images are deduplicated
to one stored file. The image field key for binding is `assetId`, not `image`.

**Draft items do not publish with the site.** Publishing the site leaves
`isDraft: true` items invisible. Publish the items separately.

**Lumos dropdowns do not self-close** when a link's default action is prevented;
the script clicks the toggle. Their visible label is `aria-hidden` and the
button has no text, so the script also sets an `aria-label`.

**Illustrator's inline fills beat CSS**, which is why hover and selection
repaint in JS rather than through a stylesheet rule.

**Page slots accept only components.** On a Lumos page, top-level blocks must be
component instances — loose elements are refused.

---

## Known limitations

- The unit dropdown lists only the current floor's units, by design.
- Floor switching resets the unit selection rather than auto-selecting.
- On mobile (<768px) the plate collapses behind a toggle and its SVG is fetched
  on first open; the unit dropdown works without ever opening it.
