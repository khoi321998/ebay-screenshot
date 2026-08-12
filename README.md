## What does eBay Screenshot do?

**eBay Screenshot** captures **full-page screenshots of eBay item and seller pages** — and of any other website you point it at — and saves each capture as a **PNG or JPEG** file in the run's key-value store. Every dataset row is a simple `{ url, screenshotUrl }` pair, the same output shape as Apify's Website Screenshot Generator, so it drops into existing pipelines without changes.

eBay is aggressively protected by Akamai and renders prices, images and seller cards with JavaScript. This Actor handles that for you: it warms an [eBay](https://www.ebay.com) session before loading item pages, routes traffic through US residential proxies, waits for the price/title elements to actually render, and scrolls the page to trigger lazy-loaded images before the shot is taken.

Running it on the Apify platform gives you API access, scheduling, integrations (Zapier, Make, Google Drive, webhooks), automatic proxy rotation and run monitoring out of the box.

## Why use eBay Screenshot?

- **Listing archives and compliance** — keep a visual record of how a listing looked at a given moment, including price, shipping and seller info.
- **Dispute and claim evidence** — a screenshot of the live listing is far more convincing than a scraped JSON blob.
- **Price and merchandising monitoring** — schedule daily captures and compare how competitor listings evolve.
- **QA and marketing assets** — grab clean, full-page renders of store pages for reports and slide decks.

## How to use eBay Screenshot

1. Click **Try for free** (or open the Actor in Apify Console).
2. Paste one or more URLs into **Start URLs** — for example `https://www.ebay.com/itm/296977871958`.
3. Optionally adjust the viewport, image format, or extra wait time.
4. Click **Start** and wait for the run to finish.
5. Open the **Output** tab to preview the screenshots, or the **Storage** tab to download the image files. The dataset can be exported as JSON, CSV, Excel or HTML.

## Input

All fields are optional except the URLs. Set them in the Input tab or via the API.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `startUrls` | array | – | Pages to capture, in request-list format (`[{ "url": "..." }]`). |
| `urls` | array | – | Plain list of URL strings; merged with `startUrls` and de-duplicated. |
| `fullPage` | boolean | `true` | Capture the whole scrollable page instead of just the viewport. |
| `viewportWidth` | integer | `1920` | Browser viewport width in pixels. |
| `viewportHeight` | integer | `1080` | Browser viewport height in pixels. |
| `waitMs` | integer | `2000` | Extra settle time before the screenshot is taken. |
| `format` | string | `png` | `png` or `jpeg`. |
| `jpegQuality` | integer | `85` | Quality of JPEG output (1–100). Ignored for PNG. |
| `maxConcurrency` | integer | `3` | Pages captured in parallel. Keep it low to avoid blocks. |
| `maxRequestRetries` | integer | `5` | Retries before a page is reported as an error. |

The Actor always runs through Apify Proxy on **US residential** IPs — eBay blocks nearly everything else, so this is not configurable.

Example input:

```json
{
    "startUrls": [{ "url": "https://www.ebay.com/itm/296977871958" }],
    "fullPage": true,
    "format": "png",
    "waitMs": 2000
}
```

## Output

Each captured page produces one dataset item. You can download the dataset in various formats such as JSON, HTML, CSV, or Excel.

```json
[
    {
        "url": "https://www.ebay.com/itm/296977871958",
        "screenshotUrl": "https://api.apify.com/v2/key-value-stores/<storeId>/records/screenshot_https_www.ebay.com_itm_296977871958_9f8c...?disableRedirect=true"
    },
    {
        "url": "https://www.ebay.com/itm/000000000000",
        "screenshotUrl": null,
        "error": "Navigation timed out"
    }
]
```

### Data fields

| Field | Type | Description |
| --- | --- | --- |
| `url` | string | The page that was requested. |
| `screenshotUrl` | string \| null | Direct link to the stored image, or `null` when the capture failed. |
| `error` | string | Present only on failures; the last error message after all retries. |

The image files themselves live in the run's default key-value store under keys prefixed with `screenshot_`, so they can also be listed and downloaded through the Apify API.

## Cost estimation

Cost is driven by browser compute time and residential proxy traffic. A single eBay item page typically takes 15–30 seconds end to end (session warm-up, render wait, lazy-load scroll, capture) and a few MB of proxy traffic. As a rough guide, a few hundred screenshots fit comfortably within the free tier's monthly credits; large batches are dominated by residential proxy cost, so use `maxConcurrency` and a datacenter proxy group if your targets are not protected.

## Tips and advanced options

- **Keep concurrency low.** eBay blocks aggressively; 1–3 parallel pages with residential IPs is the sweet spot.
- **Use JPEG for large batches.** Full-page PNGs of long listings can be several MB each; `format: "jpeg"` with quality 80–85 cuts storage significantly.
- **Turn off `fullPage`** if you only need the above-the-fold view — it skips the lazy-load scroll and is noticeably faster.
- **Raise `waitMs`** if image carousels or price widgets are still blank in the capture.
- **Non-eBay URLs work too.** Site-specific readiness gates only apply to eBay; every other URL falls back to `domcontentloaded` plus `waitMs`.

## FAQ, disclaimers, and support

**Is scraping eBay legal?** This Actor only captures publicly available pages, exactly as a visitor's browser would render them. You are responsible for using the output in line with eBay's Terms of Service and applicable law, and for not collecting personal data without a legal basis.

**Why did some URLs fail?** Anti-bot protection can still block a session after all retries. Those URLs are reported in the dataset with `screenshotUrl: null` and an `error` message — re-running them usually succeeds with a fresh proxy session.

**Why is the screenshot missing images?** Increase `waitMs`, or keep `fullPage: true` so the lazy-load scroll runs.

Found a bug or need a custom variant (element-level screenshots, PDF output, S3 upload)? Open a ticket in the **Issues** tab.

## Development

```bash
npm install       # installs deps and Playwright browsers
apify run         # runs the Actor locally against storage/key_value_stores/default/INPUT.json
HEADLESS=false apify run   # same, but with a visible browser window (local debugging)
npm test          # unit tests for input parsing and key building
npm run lint      # eslint
apify push        # deploy to the Apify platform
```

Source layout:

- `src/main.ts` — Actor entry point: input, proxy, crawler wiring.
- `src/input.ts` — input validation and defaults.
- `src/routes.ts` — the screenshot request handler.
- `src/hooks.ts` — pre/post navigation hooks (viewport, headers, eBay session warm-up, failure logging).
- `src/utils.ts` — key-value store key building and URL helpers.
