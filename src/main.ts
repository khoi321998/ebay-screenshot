/**
 * eBay (and generic) page screenshot Actor.
 *
 * Output mirrors Apify's Website Screenshot Generator - each dataset entry is
 * `{ url, screenshotUrl }`, where `screenshotUrl` points to a PNG/JPEG record
 * in the run's key-value store.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { PlaywrightCrawler } from '@crawlee/playwright';
import type { ProxyConfiguration } from 'apify';
import { Actor, KeyValueStore, log } from 'apify';

import { createPreNavigationHook, logFailedNavigation, markNavigation } from './hooks.js';
import { expandRemoteSources, normalizeInput } from './input.js';
import { createRouter } from './routes.js';
import type { Input, NormalizedInput, ProxyInput, ScreenshotResult } from './types.js';

await Actor.init();

Actor.on('aborting', async () => {
    log.info('Run is being aborted, shutting down.');
    // Give Crawlee/SDK state persistence a moment to finish before exiting.
    await sleep(1000);
    await Actor.exit();
});

/**
 * eBay only behaves for US residential IPs, so that is the default - but it is a paid
 * feature, and it is billed per gigabyte. Users capturing non-eBay pages can override it,
 * and an account without residential access degrades to a warning instead of a hard crash.
 */
const NO_PROXY_WARNING = 'Running without a proxy - eBay blocks most non-residential IPs, expect failures.';

async function buildProxyConfiguration(requested?: ProxyInput): Promise<ProxyConfiguration | undefined> {
    const wanted: ProxyInput = requested ?? {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'US',
    };

    try {
        const configuration = await Actor.createProxyConfiguration(wanted);
        if (!configuration) {
            log.warning(NO_PROXY_WARNING);
            return undefined;
        }
        log.info('Proxy configured', {
            groups: wanted.apifyProxyGroups ?? null,
            country: wanted.apifyProxyCountry ?? null,
            custom: wanted.proxyUrls ? wanted.proxyUrls.length : 0,
        });
        return configuration;
    } catch (err) {
        log.warning(`Could not use the requested proxy: ${(err as Error).message}`);
        try {
            const fallback = await Actor.createProxyConfiguration({ useApifyProxy: true });
            if (fallback) {
                log.warning('Falling back to the default Apify Proxy group. eBay may block these IPs.');
                return fallback;
            }
        } catch {
            // Fall through to the no-proxy warning below.
        }
        log.warning(NO_PROXY_WARNING);
        return undefined;
    }
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

const proxyConfiguration = await buildProxyConfiguration(normalized.proxyConfiguration);

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
