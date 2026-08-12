import type { PlaywrightHook } from '@crawlee/playwright';

import type { ScreenshotConfig } from './types.js';
import { isEbayHost, isEbayItemUrl } from './utils.js';

const EBAY_HOME_URL = 'https://www.ebay.com';

/**
 * Sets up the viewport, request headers and light anti-automation patches, then warms
 * the session against ebay.com so Akamai issues a real session cookie before we hit /itm/.
 * Item pages are always warmed - skipping the warm-up when cookies already exist leaves
 * retries stuck on the failed session's stale cookies, which Akamai keeps rejecting.
 */
export function createPreNavigationHook(config: ScreenshotConfig): PlaywrightHook {
    return async ({ page, request }) => {
        await page.setViewportSize({
            width: config.viewportWidth,
            height: config.viewportHeight,
        });

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
        });

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            (window as unknown as Record<string, unknown>).chrome = { runtime: {} };
        });

        if (!isEbayHost(request.url)) return;

        const cookies = await page.context().cookies(EBAY_HOME_URL);
        if (!isEbayItemUrl(request.url) && cookies.length > 0) return;

        await page.goto(EBAY_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1500 + Math.random() * 1000);
    };
}

/** Logs details of blocked/failed navigations so retries can be diagnosed from the run log. */
export const logFailedNavigation: PlaywrightHook = async ({ request, response, log }) => {
    const status = response?.status();
    if (!status || status < 400) return;

    const headers = response!.headers();
    log.error(`POST-NAV ${status} on ${request.url}`, {
        retryCount: request.retryCount,
        cfRay: headers['cf-ray'] ?? null,
        server: headers.server ?? null,
    });

    const body = await response!.text().catch(() => '');
    log.error('Response body snippet', { snippet: body.slice(0, 400) });
};
