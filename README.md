## What does eBay Screenshot do?

**eBay Screenshot** captures **full-page screenshots of eBay item and seller pages** — and of any other website you point it at — and saves each capture as a **PNG** file in the run's key-value store. Every dataset row is a simple `{ url, screenshotUrl }` pair, the same output shape as Apify's Website Screenshot Generator, so it drops into existing pipelines without changes.

eBay is aggressively protected by Akamai and renders prices, images and seller cards with JavaScript. This Actor handles that for you: it warms an [eBay](https://www.ebay.com) session before loading item pages, routes traffic through residential proxies, waits for the price/title elements to actually render, and scrolls the page to trigger lazy-loaded images before the shot is taken.

**Every eBay marketplace works** — `ebay.com`, `ebay.es`, `ebay.de`, `ebay.co.uk`, `ebay.com.au`, `benl.ebay.be` and the rest. The capture stays on the domain you give it, and everything locale-dependent follows that hostname automatically: the proxy exits in **that marketplace's own country**, the `Accept-Language` header matches the site, and the anti-bot warm-up hits that same domain. This matters — a US IP on `ebay.es` gets a page quoting US delivery estimates and prices converted to USD, so the screenshot would document a listing no Spanish buyer ever sees. URLs are used **exactly as you provide them**: nothing is appended to the query string and nothing is stripped, so a `?var=` variation link captures that variation.

Running it on the Apify platform gives you API access, scheduling, integrations (Zapier, Make, Google Drive, webhooks), automatic proxy rotation and run monitoring out of the box.

## Why use eBay Screenshot?

- **Listing archives and compliance** — keep a visual record of how a listing looked at a given moment, including price, shipping and seller info.
- **Dispute and claim evidence** — a screenshot of the live listing is far more convincing than a scraped JSON blob.
- **Price and merchandising monitoring** — schedule daily captures and compare how competitor listings evolve.
- **QA and marketing assets** — grab clean, full-page renders of store pages for reports and slide decks.

## How to use eBay Screenshot

1. Click **Try for free** (or open the Actor in Apify Console).
2. Paste one or more URLs into **Start URLs** — for example `https://www.ebay.com/itm/296977871958`.
3. Optionally adjust the viewport, capture height, or extra wait time.
4. Click **Start** and wait for the run to finish.
5. Open the **Output** tab to preview the screenshots, or the **Storage** tab to download the image files. The dataset can be exported as JSON, CSV, Excel or HTML.

## Input

All fields are optional except the URLs. Set them in the Input tab or via the API.

| Field                 | Type    | Default        | Description                                                                                                                                           |
| --------------------- | ------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startUrls`           | array   | –              | Pages to capture, in request-list format (`[{ "url": "..." }]`). A `{ "requestsFromUrl": "..." }` entry pointing at a text file of URLs also works.   |
| `urls`                | array   | –              | Plain list of URL strings; merged with `startUrls` and de-duplicated.                                                                                 |
| `fullPage`            | boolean | `true`         | Capture the whole scrollable page instead of just the viewport.                                                                                       |
| `viewportWidth`       | integer | `1920`         | Browser viewport width in pixels.                                                                                                                     |
| `viewportHeight`      | integer | `1080`         | Browser viewport height in pixels.                                                                                                                    |
| `waitMs`              | integer | `1000`         | Extra settle time before the screenshot is taken, on top of the readiness checks.                                                                     |
| `maxHeightPx`         | integer | `0`            | Cap the captured height of full-page screenshots; `0` captures the whole page. Useful for framing, see the tips below.                                |
| `maxConcurrency`      | integer | `3`            | Pages captured in parallel. Keep it low to avoid blocks.                                                                                              |
| `maxRequestRetries`   | integer | `5`            | Retries before a page is reported as an error.                                                                                                        |
| `maxRequestsPerCrawl` | integer | `1000`         | Safety cap on pages per run, retries included, so a huge URL list cannot consume the whole budget.                                                    |

### Proxy and marketplace — no setting to get wrong

There is no proxy option, and the anti-bot warm-up is not a switch either. Both are derived from the URLs you submit, because both only have one correct value: eBay blocks nearly everything that is not a residential IP, and it blocks item pages outright unless the session already carries cookies from that domain. The Actor therefore always runs on Apify **residential** proxies, exiting in the country of each URL's marketplace — `ebay.de` over a German IP, `ebay.com.au` over an Australian one, one configuration per country in the run, chosen per request. Non-eBay URLs, and eBay domains not in the registry, fall back to the US.

If your account cannot use residential proxies in a given country, that country is skipped with a warning and its URLs use the run's remaining proxy rather than failing. If residential is unavailable entirely, the run falls back to the default Apify Proxy group — eBay will likely block those IPs, but the run still starts.

Example input:

```json
{
    "startUrls": [{ "url": "https://www.ebay.es/itm/327221064373" }, { "url": "https://www.ebay.com/itm/296977871958" }],
    "fullPage": true,
    "maxHeightPx": 4000
}
```

Those two URLs are captured in the same run, the first over a Spanish IP and the second over a US one.

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

| Field           | Type           | Description                                                         |
| --------------- | -------------- | ------------------------------------------------------------------- |
| `url`           | string         | The page that was requested.                                        |
| `screenshotUrl` | string \| null | Direct link to the stored image, or `null` when the capture failed. |
| `error`         | string         | Present only on failures; the last error message after all retries. |

The image files themselves live in the run's default key-value store under keys prefixed with `screenshot_`, so they can also be listed and downloaded through the Apify API.

## Cost estimation

Cost is driven by browser compute time and residential proxy traffic. A measured eBay item capture takes about **16 seconds** end to end, of which roughly 8 s is navigation, 5 s is the one-off session warm-up and under 3 s is the actual screenshot work. The warm-up runs once per proxy session rather than per page, so its share shrinks as a batch grows.

The figure that really moves cost is retries: a navigation that times out spends the full `navigationTimeoutSecs` before the attempt is thrown away, which can cost more than several successful captures. Letting blocked sessions rotate quickly matters more than shaving the individual phases. Large batches are dominated by residential proxy traffic, which is billed per gigabyte.

Mixing marketplaces in one run costs a little more than splitting them: the warm-up is cached per session **per domain**, so a session that captures both `ebay.es` and `ebay.de` pays for two warm-ups instead of one. Grouping URLs by marketplace across separate runs avoids that, though at a handful of seconds per session it is rarely worth the trouble.

## Tips and advanced options

- **Keep concurrency low.** eBay blocks aggressively; 1–3 parallel pages with residential IPs is the sweet spot.
- **`maxHeightPx` is a framing option, not a speed fix.** Measured eBay pages run 3 500–4 600 px tall and encoding one takes well under a second, so capping the height saves little time. Use it when you want the listing without the recommendation carousels below it.
- **Turn off `fullPage`** if you only need the above-the-fold view — it skips the lazy-load scroll.
- **Use the marketplace URL you actually want.** `ebay.com` and `ebay.es` show the same item at different prices, in different languages, with different delivery estimates. The Actor never rewrites the host, so whichever domain you submit is the one that gets captured.
- **Raise `waitMs`** if image carousels or price widgets are still blank in the capture.
- **Non-eBay URLs work too.** Site-specific readiness gates and anti-bot detection only apply to eBay; every other URL falls back to `domcontentloaded` plus `waitMs`.
- **Blocked pages are retried, not returned.** When eBay serves an anti-bot interstitial (it does so with HTTP 200, so a status check never sees it), the Actor discards the page, retires the proxy session and retries on a fresh IP instead of saving a screenshot of the challenge.
- **Very long pages are clamped.** Documents beyond 32 000 px exceed what the browser can capture, so the top-left region is saved and a warning is logged rather than the whole request failing.

## FAQ, disclaimers, and support

**Is scraping eBay legal?** This Actor only captures publicly available pages, exactly as a visitor's browser would render them. You are responsible for using the output in line with eBay's Terms of Service and applicable law, and for not collecting personal data without a legal basis.

**Does this Actor obey robots.txt?** No, and that is a deliberate choice rather than an oversight: eBay's robots.txt disallows the very listing paths this Actor exists to capture, so enforcing it would disable the tool entirely. Because you supply the URLs, you decide what is appropriate to capture and remain responsible for complying with the target site's terms. If you need robots.txt enforcement for your own compliance posture, open a ticket in the Issues tab and it can be added as an opt-in setting.

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

- `src/main.ts` — Actor entry point: input, per-country proxy, crawler wiring.
- `src/input.ts` — input validation and defaults.
- `src/routes.ts` — the screenshot request handler.
- `src/hooks.ts` — pre/post navigation hooks (viewport, headers, eBay session warm-up, failure logging).
- `src/ebay-sites.ts` — marketplace registry: hostname → country, language, origin. Mirrored from the sibling `ebay-data-scraper` Actor; keep the two in sync.
- `src/utils.ts` — key-value store key building and URL helpers.
