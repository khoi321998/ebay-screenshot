/**
 * eBay (and generic) page screenshot Actor.
 *
 * Output mirrors Apify's Website Screenshot Generator - each dataset entry is
 * `{ url, screenshotUrl }`, where `screenshotUrl` points to a PNG/JPEG record
 * in the run's key-value store.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, KeyValueStore, log } from 'apify';

import { createPreNavigationHook, logFailedNavigation } from './hooks.js';
import { normalizeInput } from './input.js';
import { createRouter } from './routes.js';
import type { Input, NormalizedInput, ScreenshotResult } from './types.js';

await Actor.init();

Actor.on('aborting', async () => {
    log.info('Run is being aborted, shutting down.');
    // Give Crawlee/SDK state persistence a moment to finish before exiting.
    await sleep(1000);
    await Actor.exit();
});

let normalized: NormalizedInput;
try {
    normalized = normalizeInput(await Actor.getInput<Input>());
} catch (err) {
    // Fail fast with a readable message instead of an unhandled rejection stack trace.
    await Actor.fail(`Invalid input: ${(err as Error).message}`);
    throw err;
}

const { urls, config, maxConcurrency, maxRequestRetries } = normalized;

// Local debugging only: run `HEADLESS=false apify run` to watch the browser work.
const headless = process.env.HEADLESS !== 'false';

log.info(`Capturing ${urls.length} URL(s)`, { ...config, maxConcurrency, headless });
if (!headless) log.warning('Headless mode is off - a browser window will open for every page.');

// eBay only behaves for US residential IPs, so the proxy is not left up to the user.
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});
log.info('Using Apify RESIDENTIAL proxy (US)');

const store = await KeyValueStore.open();

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: createRouter(store, config),
    requestHandlerTimeoutSecs: 240,
    navigationTimeoutSecs: 90,
    minConcurrency: 1,
    maxConcurrency,
    maxRequestRetries,
    useSessionPool: true,
    sessionPoolOptions: { maxPoolSize: 20 },
    launchContext: {
        launchOptions: {
            headless,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu', // Mitigates the "crashing GPU process" issue in Docker containers
            ],
        },
    },
    preNavigationHooks: [createPreNavigationHook(config)],
    postNavigationHooks: [logFailedNavigation],
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

await Actor.exit();
