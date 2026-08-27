# Goodreads Browser

Static web app to browse your own Goodreads library quickly, with local sync and GitHub Pages deploy.

## What it does

- Exports your Goodreads library from your logged-in session in a local browser
- Converts the export into `public/data/library.json`
- Publishes a fully static site that you can host on GitHub Pages
- Focuses only on your books, your shelves, and your ratings

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

- The first run opens Chromium with a persistent profile so you can sign in to Goodreads.
- After that, the session is reused from `.playwright/goodreads-profile`.
- The generated static data is written to `public/data/library.json`.
- Raw CSV exports are kept in `data/`.
- `publicDisplayName` is optional but recommended if you want the published site to avoid showing your real name.
- The public JSON is sanitized to keep only the fields used by the site and avoid publishing Goodreads export fields such as private notes, owned copies, ISBNs, or other raw metadata.

If you want to reuse the saved login without a visible browser window:

```bash
GOODREADS_HEADLESS=true npm run sync:static
```

## Local preview

```bash
npm run serve:static
```

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
