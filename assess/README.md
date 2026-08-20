# DDI & AI self-assessment prototype

Static, browser-only self-assessment. Your assessments are saved in **localStorage** (`ddi-ai-assess-v1`). There is no server.

The example (Jordan Chen) is a completed session in `data/demo-session.json`. Open it from the home page or `example.html`. It is not written to localStorage and does not appear in My assessments. Do not use `assess.html?demo=1`. Some hosts rewrite that to `/assess` and drop the query string.

## Preview locally

From **this** folder (`self-assessment/`):

```bash
npx --yes serve .
```

Open the URL it prints (for example `http://localhost:3000`). You should see the DDI & AI self-assessment home page.

From the repository root instead:

```bash
npx --yes serve self-assessment
```

Or:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## GitHub Pages

The prototype is published at **`/assess/`** on GitHub Pages. The site root is the framework publication (HTML guides + data downloads). Build with `npm run build:pages`, then publish `dist/` to the `gh-pages` branch of [theodi/gs-ddi-framework](https://github.com/theodi/gs-ddi-framework) with `npm run deploy:pages`.

In that repo, set **Settings → Pages → Source** to **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**.

Expected URLs:

- Publication: `https://ddi.learndata.info/`
- This prototype: `https://ddi.learndata.info/assess/`

To preview the combined site from the repository root:

```bash
npm run build:pages
npx --yes serve dist
```

## Refresh framework content

From the repository root:

```bash
node scripts/sync-assess-data.mjs
```

That copies the JSON this app needs from `data/` into `self-assessment/data/`.

## AI (later)

Coaching and AI prefill are off. When a backend exists, set `AI_API_BASE` in `js/ai-config.js` and add authentication on that API. Assessment data stays in the browser.
