# Goodreads Browser

Static web app to browse your own Goodreads library quickly, with local sync and GitHub Pages deploy.

## What it does

- Exports your Goodreads library from your logged-in session in a local browser
- Converts the export into `public/data/library.json`
- Publishes a fully static site that you can host on GitHub Pages
- Focuses only on your books, your shelves, and your ratings
- Filters by publication year or reading/finish year. Reading years use Goodreads' recorded `dateRead`, not the date a book was added; books without a finish date remain visible under "Todos".
- Infinite scroll appends books in batches (24 on desktop, 12 on mobile), with lazy-loaded covers and an accessible "Cargar más" button that also works without automatic scrolling. Changing filters or sorting restarts the list.
- Search and filters stay above the results on tablet and mobile. Keyboard navigation includes a skip link, visible focus indicators, and labelled reading-chart points; reduced-motion preferences are respected.
- Covers use responsive Goodreads image sizes, retry the original URL if a resized image fails, and retain accessible link names even without a cover.
- Reading statistics use UTC dates, matching the reading-year filter. The monthly timeline includes months with zero reads and shows up to the last 12 consecutive months ending at the latest recorded reading.

## Local setup

Create `config.json` from `config.example.json`:

```json
{
  "goodreads": {
    "displayName": "Your Name",
    "publicDisplayName": "Mi biblioteca",
    "profileDir": ".playwright/goodreads-profile"
  }
}
```

Install dependencies:

```bash
npm install
```

Run the sync locally:

```bash
npm run sync:static
```

Notes:

- The sync opens a visible Chromium window by default and reuses the persistent session from `.playwright/goodreads-profile`.
- To run without a visible browser, set `GOODREADS_HEADLESS=true`. CI always runs headless.
- If Goodreads asks you to sign in again, complete the login in the opened browser window; the sync will continue automatically.
- If Goodreads blocks the browser, times out, or does not expose a fresh export, the sync exits without changing the generated library files. This prevents an old CSV from being published with a new sync timestamp.
- To intentionally rebuild from the newest local CSV, run `GOODREADS_ALLOW_STALE_FALLBACK=true npm run sync:static`. This recovery mode keeps `lastSyncedAt` set to the CSV file's actual modification time.
- The generated static data is written to `public/data/library.json`.
- All pages share the same validated JSON loader with a 15-second request timeout and a visible retry action on failure. The duplicate `library.js` data bundle is no longer generated or needed.
- Covers and other missing metadata are fetched from each book's Goodreads page first, with search as a fallback. Metadata requests have bounded redirects and timeouts; incomplete enrichment is reported as a warning, including missing covers in the data integrity check.
- Raw CSV exports are kept in `data/`.
- `publicDisplayName` is optional but recommended if you want the published site to avoid showing your real name.
- The public JSON is sanitized to keep only the fields used by the site and avoid publishing Goodreads export fields such as private notes, owned copies, ISBNs, or other raw metadata.

## Local preview

```bash
npm run serve:static
```

Open <http://localhost:3000>. Use the HTTP preview rather than opening the HTML files directly so the browser can fetch the shared JSON.

## Development checks

```bash
npm test
npx playwright install chromium
npm run test:browser
```

The browser checks start and stop their own loopback server and cover desktop/mobile filtering, pagination, statistics, unsafe metadata, image fallbacks, and recovery from failed or malformed data. They use fixtures, not Goodreads or your logged-in session. CI runs both suites.

For Lighthouse, start the local preview and audit both `http://localhost:3000/` and `http://localhost:3000/stats.html` with `npx lighthouse <url>`. Compare runs using the same device preset and server. Local Python preview does not provide compression or long-lived cache headers, and cover caching is controlled by the external image hosts. The deliberately retained `noindex` directives and `robots.txt` lower SEO scores; do not remove them just to raise Lighthouse scores.

## GitHub Pages

Push to `main` and the workflow in `.github/workflows/pages.yml` will deploy `public/`.

Privacy note:

- GitHub Pages should be treated as a public website unless you are intentionally using a private Pages setup supported by your plan.
- This project already adds `noindex` and publishes a reduced JSON, but anyone with the URL can still access the published data.

## About automation

The deploy is easy to automate in GitHub Actions because the site is static.

The Goodreads sync is intentionally local-first:

- it depends on your logged-in Goodreads session
- that session is private and should not be committed
- cloud automation for logged-in scraping is much more brittle than local export

So the recommended flow is:

1. Run `npm run sync:static` locally.
2. Commit the updated `public/data/library.json`.
3. Push to `main`.
4. GitHub Pages deploys automatically.
