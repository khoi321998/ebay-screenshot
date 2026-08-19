/**
 * eBay (and generic) page screenshot Actor.
 *
 * Output mirrors Apify's Website Screenshot Generator - each dataset entry is
 * `{ url, screenshotUrl }`, where `screenshotUrl` points to a PNG/JPEG record
 * in the run's key-value store.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { PlaywrightCrawler, ProxyConfiguration } from '@crawlee/playwright';
import { Actor, KeyValueStore, log } from 'apify';

import { DEFAULT_SITE, siteFor } from './ebay-sites.js';
import { createPreNavigationHook, logFailedNavigation, markNavigation } from './hooks.js';
import { expandRemoteSources, normalizeInput } from './input.js';
import { createRouter } from './routes.js';
import type { Input, NormalizedInput, ScreenshotResult } from './types.js';

await Actor.init();

Actor.on('aborting', async () => {
    log.info('Run is being aborted, shutting down.');
    // Give Crawlee/SDK state persistence a moment to finish before exiting.
    await sleep(1000);
    await Actor.exit();
});

/**
 * eBay tolerates residential IPs and little else, so that is what every capture runs on. It is
 * a paid feature; an account without residential access degrades to a warning and the default
 * proxy group instead of a hard crash.
 */
const NO_PROXY_WARNING = 'Running without a proxy - eBay blocks most non-residential IPs, expect failures.';

/**
 * Builds the proxy for the run, exiting in each marketplace's own country.
 *
 * A US IP loads ebay.es fine, but eBay then renders it as it would for an American shopper -
 * US delivery estimates, prices converted to USD, sometimes a redirect to ebay.com outright -
 * so the screenshot documents a listing no Spanish buyer would ever see. The country therefore
 * follows the hostname, not a setting: one Apify configuration per country present in the run,
 * dispatched per request. Anything that is not an eBay domain falls back to the default site's
 * country, which keeps plain website captures behaving as they did before.
 */
async function buildProxyConfiguration(urls: string[]): Promise<ProxyConfiguration | undefined> {
    const countries = [...new Set(urls.map((url) => siteFor(url).countryCode))];
    const byCountry = new Map<string, ProxyConfiguration>();

    for (const countryCode of countries) {
        try {
            const configuration = await Actor.createProxyConfiguration({
                groups: ['RESIDENTIAL'],
                countryCode,
            });
            if (configuration) byCountry.set(countryCode, configuration);
        } catch (err) {
            // Not every residential country is available on every plan - fall back rather than die.
            log.warning(`Residential proxy for ${countryCode} unavailable: ${(err as Error).message}`);
        }
    }

    // Requests whose country could not be configured still need an exit somewhere.
    const fallback = byCountry.get(DEFAULT_SITE.countryCode) ?? [...byCountry.values()][0];

    if (!fallback) {
        try {
            const generic = await Actor.createProxyConfiguration({ useApifyProxy: true });
            if (generic) {
                log.warning('No residential proxy available, falling back to the default Apify Proxy group.');
                return generic;
            }
        } catch {
            // Fall through to the no-proxy warning below.
        }
        log.warning(NO_PROXY_WARNING);
        return undefined;
    }

    log.info(`Using Apify RESIDENTIAL proxy, countries: ${[...byCountry.keys()].join(', ')}`);

    // One country in the run means no dispatch is needed - use the configuration directly so
    // Crawlee keeps its own session/tier handling instead of routing through a custom function.
    if (byCountry.size === 1) return fallback;

    return new ProxyConfiguration({
        newUrlFunction: async (sessionId, options) => {
            const url = options?.request?.url;
            const configuration = (url ? byCountry.get(siteFor(url).countryCode) : null) ?? fallback;
            return (await configuration.newUrl(sessionId)) ?? null;
        },
    });
}

let normalized: NormalizedInput;
try {
    normalized = normalizeInput(await Actor.getInput<Input>());
} catch (err) {
    // Fail fast with a readable message instead of an unhandled rejection stack trace.
    await Actor.fail(`Invalid input: ${(err as Error).message}`);
    throw err;
}

const { config, maxConcurrency, maxRequestRetries, maxRequestsPerCrawl } = normalized;

// Entries pointing at a remote list of URLs are downloaded here, then merged and de-duplicated.
const urls = [...new Set([...normalized.urls, ...(await expandRemoteSources(normalized.remoteSources))])];

if (!urls.length) {
    const message = 'No valid URLs to capture - the remote URL list resolved to nothing.';
    await Actor.fail(message);
    throw new Error(message);
}

// Local debugging only: run `HEADLESS=false apify run` to watch the browser work.
const headless = process.env.HEADLESS !== 'false';

log.info(`Capturing ${urls.length} URL(s)`, { ...config, maxConcurrency, maxRequestsPerCrawl, headless });
if (!headless) log.warning('Headless mode is off - a browser window will open for every page.');

const proxyConfiguration = await buildProxyConfiguration(urls);

const store = await KeyValueStore.open();

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: createRouter(store, config),
    requestHandlerTimeoutSecs: 240,
    // Navigation stops at `domcontentloaded`, which measured 4.5-8s on live eBay item pages.
    // A page that has not reached it in 30s is not going to, and a longer timeout only makes
    // the failure path slower: one timed-out attempt already costs more than a whole capture.
    navigationTimeoutSecs: 30,
    minConcurrency: 1,
    maxConcurrency,
    maxRequestRetries,
    maxRequestsPerCrawl,
    useSessionPool: true,
    sessionPoolOptions: { maxPoolSize: 20 },
    launchContext: {
        // Isolate cookies per page. Without this every page shares one cookie jar, so cookies
        // issued to one proxy IP get replayed from another - which defeats session rotation
        // and is exactly the inconsistency anti-bot systems look for. Crawlee re-applies each
        // session's own cookies to the fresh context before navigating.
        useIncognitoPages: true,
        launchOptions: {
            headless,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu', // Mitigates the "crashing GPU process" issue in Docker containers
                '--disable-dev-shm-usage', // /dev/shm is tiny in containers; without this Chrome falls back to disk
            ],
        },
    },
    preNavigationHooks: [createPreNavigationHook(config)],
    postNavigationHooks: [markNavigation, logFailedNavigation],
    failedRequestHandler: async ({ request }, error) => {
        const message = error?.message || 'Unknown error';
        log.error(`Screenshot failed: ${request.url}`, {
            retryCount: request.retryCount,
            error: message,
        });
        await Actor.pushData({
            url: request.url,
            screenshotUrl: null,
            error: message,
        } satisfies ScreenshotResult);
    },
});

await crawler.run(urls);

const { requestsFinished, requestsFailed } = crawler.stats.state;
log.info(`Done: ${requestsFinished} screenshot(s) captured, ${requestsFailed} failed out of ${urls.length} URL(s).`);
if (requestsFailed > 0) {
    log.warning('Failed URLs are in the dataset with `screenshotUrl: null` and an `error` message.');
}

await Actor.exit();
