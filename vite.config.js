import { defineConfig } from 'vite';

/**
 * Dev server for the interactive floor plan.
 *
 * The published Webflow site loads these files from jsDelivr. With the dev
 * flag set in the browser, it loads them from here instead — so you can edit
 * and refresh without committing, bumping a SHA, or republishing Webflow.
 *
 * In the browser console on the Webflow site:
 *   localStorage.setItem('cprt-fp-dev', 'true')    // use local files
 *   localStorage.removeItem('cprt-fp-dev')         // back to the CDN
 */
export default defineConfig({
  server: {
    // 5173 is taken by the other CPRT build (addisongabriel/cprt), so this
    // sits on 5174 and the two can run side by side.
    port: 5174,
    strictPort: true,

    // The page is served from webflow.io and the files from localhost, so the
    // dev server has to allow cross-origin requests or the browser blocks them.
    cors: true,
  },

  // No build step: the files are plain browser assets, served as-is and
  // published straight from src/ on the CDN. `vite build` is not part of the
  // workflow — if that changes, the CDN paths in the loader change too.
  appType: 'mpa',
});
