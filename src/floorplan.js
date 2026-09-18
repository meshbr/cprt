/**
 * Interactive floor plan
 * ----------------------
 * Binds a Webflow CMS-driven floor plan: a floor dropdown, an SVG floor plate
 * with clickable unit hotspots, a unit dropdown, and a detail panel.
 *
 * The script reads its data from hidden elements inside two Webflow Collection
 * Lists, addressed by DOM id. Webflow's API cannot bind CMS values to `data-`
 * attributes, which is why the pattern is bound child elements rather than
 * something tidier. See README.md for the full contract.
 *
 * Self-executing and guarded: on a page without `.fpx-section` it does nothing,
 * so it is safe to load site-wide.
 */
(function () {
  'use strict';

  var MOBILE = '(max-width: 767px)';

  /**
   * Unit colours come from CSS custom properties on .fpx-section, which
   * themselves default to the site's theme variables. Reading them at runtime
   * means the plate follows the Section's Theme with no hardcoded palette here.
   */
  function readColors(section) {
    var styles = getComputedStyle(section);
    return {
      // currentColor as the fallback keeps this theme-driven even if the
      // variables are missing: it resolves to the inherited text colour.
      selected: styles.getPropertyValue('--fpx-unit-selected').trim() || 'currentColor',
      hover: styles.getPropertyValue('--fpx-unit-hover').trim() || 'currentColor',
      unitBase: styles.getPropertyValue('--fpx-unit-base').trim(),
      structure: styles.getPropertyValue('--fpx-structure').trim(),
      stroke: styles.getPropertyValue('--fpx-stroke').trim(),
      labelOnUnit: styles.getPropertyValue('--fpx-label-on-unit').trim(),
      strokeWidth: styles.getPropertyValue('--fpx-stroke-width').trim()
    };
  }

  function text(root, selector) {
    var el = root.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  function isMobile() {
    return window.matchMedia(MOBILE).matches;
  }

  /**
   * Find a unit's shape in the SVG.
   *
   * Illustrator prefixes an underscore when an id would otherwise start with a
   * digit, so `525-unit-400` is exported as `_525-unit-400`. Older exports used
   * `data-name` instead. This tries every form so the SVGs import unedited.
   */
  function findShape(svg, slug) {
    if (!svg || !slug) return null;
    var candidates = [slug, '_' + slug];
    for (var i = 0; i < candidates.length; i++) {
      var id = candidates[i];
      var hit = svg.getElementById ? svg.getElementById(id) : null;
      if (hit) return hit;
      try {
        hit = svg.querySelector('[id="' + id + '"]') ||
              svg.querySelector('[data-name="' + id + '"]');
      } catch (e) {
        hit = null;
      }
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Webflow decimal number fields return "1.0". Render "1", but leave "1.5".
   */
  function tidyNumber(value) {
    if (value == null) return '';
    var s = String(value).trim();
    if (!s) return '';
    var f = parseFloat(s);
    return isNaN(f) ? s : String(f);
  }

  /**
   * Unit-number labels sit in their own SVG group, painted on top of the
   * hotspots, so a click on the number never reaches the unit beneath. Making
   * them transparent to the mouse lets clicks and hovers fall through.
   */
  function labelsClickThrough(svg) {
    if (!svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll('text, tspan'), function (el) {
      el.style.pointerEvents = 'none';
      // Borrow the site's heading style for the labels. Illustrator writes
      // font-family and fill inline, which would beat the class, so strip
      // those. font-size stays: it is in SVG user units, drawn to fit inside
      // each unit, so letting CSS set it would break the smaller shapes.
      el.style.removeProperty('font-family');
      el.style.removeProperty('fill');
      el.removeAttribute('font-family');
      el.removeAttribute('fill');
      if (el.classList) el.classList.add('u-text-style-h6');
    });
    Array.prototype.forEach.call(svg.querySelectorAll('g'), function (el) {
      var key = ((el.getAttribute('id') || '') + ' ' +
                 (el.getAttribute('data-name') || '')).toLowerCase();
      if (key.indexOf('label') > -1) el.style.pointerEvents = 'none';
    });
  }

  /**
   * Repaint a unit. Illustrator writes inline fills onto the paths, which beat
   * any stylesheet rule — so hover and selection both have to set fills in JS
   * rather than via CSS. `data-of` stashes the original so it can be restored.
   */
  function paint(el, color) {
    if (!el) return;
    el.style.fill = color;
    var shapes = el.querySelectorAll
      ? el.querySelectorAll('polygon, path, rect, circle, polyline')
      : [];
    Array.prototype.forEach.call(shapes, function (shape) {
      if (color) {
        if (!shape.hasAttribute('data-of')) {
          shape.setAttribute('data-of', shape.style.fill || '');
        }
        shape.style.fill = color;
      } else if (shape.hasAttribute('data-of')) {
        shape.style.fill = shape.getAttribute('data-of');
        shape.removeAttribute('data-of');
      }
    });
  }

  /**
   * Repaint without stashing the previous value, and clear any stash, so the
   * new colour becomes what hover and selection restore back to.
   */
  function repaintBase(el, color) {
    if (!el || !color || color === 'none') return;
    el.style.fill = color;
    var shapes = el.querySelectorAll
      ? el.querySelectorAll('polygon, path, rect, circle, polyline')
      : [];
    Array.prototype.forEach.call(shapes, function (shape) {
      if (isLight(shape)) return;   // leave icons and other light marks alone
      shape.style.fill = color;
      shape.removeAttribute('data-of');
    });
  }

  /**
   * Near-white test. These literals are not palette choices: they read what
   * Illustrator already wrote into the drawing, so pictograms inside amenity
   * rooms survive a repaint instead of vanishing into it.
   */
  function isLight(shape) {
    var fill = (shape.style.fill || shape.getAttribute('fill') || '').trim().toLowerCase();
    if (!fill || fill === 'none') return true;
    if (fill === 'white' || fill === '#fff' || fill === '#ffffff') return true;
    var m = fill.match(/^#([0-9a-f]{6})$/);
    if (m) {
      var n = parseInt(m[1], 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return (r * 0.299 + g * 0.587 + b * 0.114) > 225;
    }
    return false;
  }

  var STRUCTURE = /stair|storage|elevator|core|amenity|fitness|corridor|hall|lobby|trash|mech/i;

  /**
   * Unit labels sit in their own group, so they cannot inherit the unit's fill.
   * When units are dark, their labels need to go light while structural labels
   * ("STAIRS", "AMENITY ROOM") stay dark on their lighter backgrounds. Match by
   * the number in the label text against the units on this floor.
   */
  /** Find the label element whose number matches this unit. */
  function labelFor(svg, number) {
    var hit = null;
    Array.prototype.forEach.call(svg.querySelectorAll('text'), function (el) {
      if (hit) return;
      if ((el.textContent || '').replace(/\D+/g, '') === number) hit = el;
    });
    return hit;
  }

  function paintLabel(el, color) {
    if (!el) return;
    el.style.fill = color || '';
    Array.prototype.forEach.call(el.querySelectorAll('tspan'), function (t) {
      t.style.fill = color || '';
    });
  }

  function tintLabels(svg, numbers, color) {
    if (!svg || !color || color === 'none' || !numbers.length) return;
    Array.prototype.forEach.call(svg.querySelectorAll('text'), function (el) {
      var digits = (el.textContent || '').replace(/\D+/g, '');
      if (!digits || numbers.indexOf(digits) === -1) return;
      el.style.fill = color;
      Array.prototype.forEach.call(el.querySelectorAll('tspan'), function (t) {
        t.style.fill = color;
      });
    });
  }

  /**
   * Recolour every stroke in the drawing. Only shapes that already have a
   * stroke are touched, so this changes the outlines' colour without adding
   * any, and the line weights Illustrator set are left as they are.
   */
  function tintStrokes(svg, color, width) {
    if (!svg || (!color && !width)) return;
    var shapes = svg.querySelectorAll('polygon, path, rect, circle, polyline, line, g');
    Array.prototype.forEach.call(shapes, function (shape) {
      var stroke = (shape.style.stroke || shape.getAttribute('stroke') || '').trim().toLowerCase();
      if (!stroke || stroke === 'none') return;
      if (color && color !== 'none') {
        shape.style.stroke = color;
        shape.removeAttribute('stroke');
      }
      // Width is in SVG user units, so it scales with the drawing.
      if (width && width !== 'none') {
        shape.style.strokeWidth = width;
        shape.removeAttribute('stroke-width');
      }
    });
  }

  /** Tint the non-unit parts of the plate so the drawing sits in the palette. */
  function tintStructure(svg, color) {
    if (!svg || !color || color === 'none') return;
    Array.prototype.forEach.call(svg.querySelectorAll('g'), function (g) {
      var key = (g.getAttribute('id') || '') + ' ' + (g.getAttribute('data-name') || '');
      if (STRUCTURE.test(key)) repaintBase(g, color);
    });
  }

  /**
   * The CTA may be a plain <a id="fpxCta">, or a wrapper with that id holding a
   * Button Main component — whose <a> is rendered by a nested Clickable and so
   * cannot carry an id of its own. Show/hide the wrapper, set href on the link.
   */
  function resolveCta() {
    var el = document.getElementById('fpxCta');
    if (!el) return null;
    if (el.tagName === 'A') return { wrap: el, link: el };
    var link = el.querySelector('a');
    return { wrap: el, link: link || el };
  }

  function init() {
    var section = document.querySelector('.fpx-section');
    if (!section) return;

    var COLORS = readColors(section);
    var plate = document.getElementById('fpxPlate');
    var data = section.querySelector('.fpx-data');
    var panel = document.getElementById('fpxBody');
    var emptyState = document.getElementById('fpxEmpty');

    var currentFloor = null;
    var paintedShape = null;
    var paintedLabel = null;
    var loadedFloor = null;
    var floors = [];
    var floorBySlug = {};
    var featuredSlug = null;
    var floorUI = null;
    var unitUI = null;
    var units = [];

    // --- identify the two Lumos dropdowns by what they contain -------------
    Array.prototype.forEach.call(section.querySelectorAll('.dropdown_wrap'), function (wrap) {
      var ui = {
        wrap: wrap,
        label: wrap.querySelector('.dropdown_toggle_text'),
        toggle: wrap.querySelector('.dropdown_toggle_clickable')
      };
      if (wrap.querySelector('#fpx-f-slug')) floorUI = ui;
      else if (data && wrap.contains(data)) unitUI = ui;
    });

    // Lumos does not auto-close when the link's default action is prevented.
    function closeDropdown(ui) {
      if (ui && ui.toggle && ui.toggle.getAttribute('aria-expanded') === 'true') {
        ui.toggle.click();
      }
    }

    // --- floors ------------------------------------------------------------
    section.querySelectorAll('.dropdown_content .w-dyn-item').forEach(function (item) {
      var slug = text(item, '#fpx-f-slug');
      if (!slug) return; // unit items live in the other dropdown

      var svgLink = item.querySelector('#fpx-f-svg');
      var number = parseInt(text(item, '#fpx-f-num'), 10);

      floorBySlug[slug] = {
        name: text(item, '#fpx-f-name'),
        slug: slug,
        number: isNaN(number) ? 0 : number,
        svg: svgLink ? svgLink.getAttribute('href') : ''
      };
      floors.push(floorBySlug[slug]);

      // The featured carrier's visibility is bound to the CMS switch, so it
      // only renders when the switch is on. Presence is the whole signal.
      if (item.querySelector('#fpx-f-featured')) featuredSlug = slug;

      var link = item.querySelector('#fpx-f-link') || item.querySelector('a');
      if (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          showFloor(slug);
          closeDropdown(floorUI);
        });
      }
    });

    if (!floors.length) return;
    floors.sort(function (a, b) { return a.number - b.number; });

    // --- units: read once, filter per floor --------------------------------
    if (data) {
      data.querySelectorAll('.w-dyn-item').forEach(function (item) {
        var slug = text(item, '#u-slug');
        if (!slug) return;

        var img = item.querySelector('#u-img');
        var url = item.querySelector('#u-url');

        var unit = {
          item: item,
          slug: slug,
          floor: text(item, '#u-floor'),
          name: text(item, '#u-name') || slug,
          type: text(item, '#u-type'),
          beds: text(item, '#u-bd'),
          baths: text(item, '#u-ba'),
          sqft: text(item, '#u-sf'),
          description: text(item, '#u-desc'),
          image: img ? img.getAttribute('src') : '',
          url: url ? url.getAttribute('href') : '',
          shape: null
        };
        units.push(unit);

        var link = item.querySelector('#fpx-u-link') || item.querySelector('a');
        if (link) {
          link.addEventListener('click', function (e) {
            e.preventDefault();
            selectUnit(unit);
            closeDropdown(unitUI);
          });
        }
      });
    }

    // --- mobile plate toggle ----------------------------------------------
    var plateToggle = document.createElement('button');
    plateToggle.type = 'button';
    plateToggle.className = 'fpx-plate-toggle';
    plateToggle.setAttribute('aria-expanded', 'false');
    plateToggle.textContent = 'View floor plan';
    plate.parentNode.insertBefore(plateToggle, plate);

    plateToggle.addEventListener('click', function () {
      var wasOpen = plateToggle.getAttribute('aria-expanded') === 'true';
      plateToggle.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
      plateToggle.textContent = wasOpen ? 'View floor plan' : 'Hide floor plan';
      if (wasOpen) plate.setAttribute('hidden', '');
      else plate.removeAttribute('hidden');

      // The SVGs are 100–200 KB. On mobile, fetch only on first open.
      if (!wasOpen && currentFloor && loadedFloor !== currentFloor.slug) {
        loadPlate(currentFloor);
      }
    });

    function applyCollapse() {
      if (isMobile() && plateToggle.getAttribute('aria-expanded') !== 'true') {
        plate.setAttribute('hidden', '');
      } else {
        plate.removeAttribute('hidden');
      }
    }
    applyCollapse();

    if (panel) panel.style.display = 'none';

    var closeButton = document.getElementById('fpxClose');
    if (closeButton) {
      closeButton.style.cursor = 'pointer';
      closeButton.addEventListener('click', clearSelection);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && panel.style.display !== 'none') {
        clearSelection();
      }
    });

    showFloor(featuredSlug || floors[0].slug);

    // --- behaviour ---------------------------------------------------------

    function showFloor(slug) {
      var floor = floorBySlug[slug];
      if (!floor) return;

      currentFloor = floor;
      loadedFloor = null;

      if (floorUI && floorUI.label) floorUI.label.textContent = floor.name;
      if (floorUI && floorUI.toggle) {
        // The visible label is aria-hidden and the button has no text of its
        // own, so without this a screen reader announces nothing useful.
        floorUI.toggle.setAttribute(
          'aria-label',
          'Floor plan: ' + floor.name + '. Choose a different floor.'
        );
      }
      if (unitUI && unitUI.label) unitUI.label.textContent = 'Choose a Unit';

      units.forEach(function (unit) {
        unit.item.style.display = unit.floor === slug ? '' : 'none';
        unit.shape = null;
      });

      clearSelection();
      applyCollapse();

      if (isMobile() && plateToggle.getAttribute('aria-expanded') !== 'true') {
        plate.innerHTML = '';
        return;
      }
      loadPlate(floor);
    }

    function loadPlate(floor) {
      if (!floor.svg || floor.svg === '#') {
        plate.innerHTML = '<p class="fpx-plate-msg">No floor plan uploaded for this floor.</p>';
        return;
      }
      plate.innerHTML = '<p class="fpx-plate-msg">Loading\u2026</p>';

      fetch(floor.svg)
        .then(function (res) {
          if (!res.ok) throw new Error('fetch failed');
          return res.text();
        })
        .then(function (markup) {
          // Guard against a slow response arriving after another floor was picked.
          if (!currentFloor || currentFloor.slug !== floor.slug) return;

          var doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
          var svg = doc.querySelector('svg');
          if (!svg || doc.querySelector('parsererror')) throw new Error('bad svg');

          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          // Let CSS size it: width/height auto with max-* lets the plate's
          // height cap scale the drawing instead of clipping it. Setting an
          // explicit width here would override that.
          svg.style.display = 'block';

          plate.innerHTML = '';
          plate.appendChild(document.importNode(svg, true));

          var live = plate.querySelector('svg');
          labelsClickThrough(live);
          tintStructure(live, COLORS.structure);
          tintStrokes(live, COLORS.stroke, COLORS.strokeWidth);
          bindHotspots(live, floor.slug);
          loadedFloor = floor.slug;
        })
        .catch(function () {
          plate.innerHTML = '<p class="fpx-plate-msg">Floor plan could not be loaded.</p>';
        });
    }

    function bindHotspots(svg, floorSlug) {
      if (!svg) return;
      var missing = [];
      var bound = [];

      units.forEach(function (unit) {
        if (unit.floor !== floorSlug) return;

        var shape = findShape(svg, unit.slug);
        if (!shape) {
          missing.push(unit.slug);
          return;
        }
        unit.shape = shape;
        // Take the trailing segment of the slug: 525-unit-400 -> "400".
        // Stripping all non-digits would give "525400" and match nothing.
        var number = String(unit.slug).split('-').pop();
        bound.push(number);
        unit.label = labelFor(svg, number);
        repaintBase(shape, COLORS.unitBase);

        shape.setAttribute('class', ((shape.getAttribute('class') || '') + ' fpx-linked').trim());
        shape.setAttribute('tabindex', '0');
        shape.setAttribute('role', 'button');
        shape.style.cursor = 'pointer';
        shape.setAttribute(
          'aria-label',
          unit.name +
            (unit.type ? ', ' + unit.type : '') +
            (unit.sqft ? ', ' + unit.sqft + ' square feet' : '')
        );

        // Hover and focus both preview; the selected unit keeps its colour.
        function hoverOn() { if (paintedShape !== shape) paint(shape, COLORS.hover); }
        function hoverOff() { if (paintedShape !== shape) paint(shape, ''); }

        shape.addEventListener('mouseenter', hoverOn);
        shape.addEventListener('mouseleave', hoverOff);
        shape.addEventListener('focus', hoverOn);
        shape.addEventListener('blur', hoverOff);
        shape.addEventListener('click', function () { selectUnit(unit); });
        shape.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectUnit(unit);
          }
        });
      });

      tintLabels(svg, bound, COLORS.labelOnUnit);

      // Only this floor's units are attempted, so anything here is a real
      // mismatch between a unit slug and the SVG — worth investigating.
      if (missing.length && window.console) {
        console.warn('[fpx] No SVG path for: ' + missing.join(', '));
      }
    }

    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value == null ? '' : value;
    }

    function clearSelection() {
      if (paintedLabel) {
        paintLabel(paintedLabel, '');
        paintedLabel = null;
      }
      if (paintedShape) {
        paint(paintedShape, '');
        paintedShape = null;
      }
      if (panel) panel.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    }

    function selectUnit(unit) {
      if (paintedLabel) paintLabel(paintedLabel, '');
      if (paintedShape) paint(paintedShape, '');
      if (unit.shape) paint(unit.shape, COLORS.selected);
      paintedShape = unit.shape;
      // The selected fill is dark; its label has to lighten to stay readable.
      if (unit.label && COLORS.labelOnUnit && COLORS.labelOnUnit !== 'none') {
        paintLabel(unit.label, COLORS.labelOnUnit);
        paintedLabel = unit.label;
      }

      if (unitUI && unitUI.label) unitUI.label.textContent = unit.name;

      setText('fpxName', unit.name);
      setText('fpxType', unit.type);
      setText('fpxBd', tidyNumber(unit.beds));
      setText('fpxBa', tidyNumber(unit.baths));
      setText('fpxSf', unit.sqft ? Number(unit.sqft).toLocaleString() : '');
      setText('fpxDesc', unit.description);

      var img = document.getElementById('fpxImg') || document.querySelector('.fpx-plan');
      if (img) {
        if (unit.image) {
          img.src = unit.image;
          img.removeAttribute('srcset');
          img.alt = 'Floor plan for ' + unit.name;
          img.style.display = 'block';
        } else {
          img.style.display = 'none';
        }
      }

      var cta = resolveCta();
      if (cta) {
        if (unit.url) {
          if (cta.link.tagName === 'A') {
            cta.link.href = unit.url;
            cta.link.target = '_blank';
            cta.link.rel = 'noopener noreferrer';
          }
          cta.wrap.style.display = '';
        } else {
          cta.wrap.style.display = 'none';
        }
      }

      if (emptyState) emptyState.style.display = 'none';
      if (panel) panel.style.display = 'block';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();