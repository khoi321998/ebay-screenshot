import { type PlaywrightHook, playwrightUtils } from '@crawlee/playwright';

import { markPhase, resetTiming } from './timing.js';
import type { ScreenshotConfig } from './types.js';
import { isEbayHost, TRACKER_URL_PATTERNS } from './utils.js';

const EBAY_HOME_URL = 'https://www.ebay.com';

/**
 * Sets up the viewport, request headers and light anti-automation patches, then warms
 * the session against ebay.com so Akamai issues a real session cookie before we hit /itm/.
 *
 * The warm-up costs a full extra page load, so it runs once per session rather than once
 * per request: with `useIncognitoPages` each page starts cookie-free and Crawlee re-applies
 * the session's cookie jar, so a session that is already warm stays warm. A retry always
 * warms again - the previous attempt's cookies are exactly the ones Akamai just rejected.
 *
 * Note: `page.context().cookies()` is deliberately *not* used to decide *whether* to warm.
 * Crawlee applies session cookies only after the pre-navigation hooks run, so the context
 * still looks empty here; the session's own `userData` is the reliable signal.
 */
export function createPreNavigationHook(config: ScreenshotConfig): PlaywrightHook {
    return async ({ page, request, session, log }, gotoOptions) => {
        resetTiming(request);

        // eBay never fires `load` cleanly (ads, beacons, lazy media), and Playwright's default
        // waitUntil is `load`. The readiness gates in the request handler cover settling, so
        // stopping at `domcontentloaded` avoids burning the whole navigation timeout per page.
        // Mutating `gotoOptions` is how a Crawlee hook is meant to steer the navigation.
        // eslint-disable-next-line no-param-reassign
        if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';

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

        // Analytics and ad endpoints never change what the page looks like, but they do cost
        // load time and residential proxy traffic, which is billed per gigabyte.
        if (config.blockTrackers) {
            await playwrightUtils.blockRequests(page, { urlPatterns: [...TRACKER_URL_PATTERNS] });
        }

        markPhase(request, 'setup');

        if (!config.warmUpSession || !isEbayHost(request.url)) return;

        const isRetry = request.retryCount > 0;
        if (session?.userData?.ebayWarmed === true && !isRetry) return;

        if (isRetry) {
            // Drop whatever the failed attempt collected before asking for a fresh cookie.
            await page
                .context()
                .clearCookies()
                .catch(() => undefined);
        }

        log.debug(`Warming eBay session${isRetry ? ' (retry)' : ''}: ${request.url}`);
        // `commit` resolves as soon as the response arrives, which is when Akamai's Set-Cookie
        // headers land - waiting for the full homepage DOM costs ~12s and buys nothing. The
        // sleep afterwards is the part that matters: it lets the sensor script run and turn
        // `_abck` into a valid token. Skipping the warm-up entirely returns 403, so it stays.
        await page.goto(EBAY_HOME_URL, { waitUntil: 'commit', timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(1500 + Math.random() * 1000);

        // Hand the freshly issued cookies to the Session. This warm-up is a manual `goto`,
        // so Crawlee never sees its response and the session would keep serving the cookies
        // from the *previous* attempt - which `_applyCookies` then writes over the new ones
        // right after this hook returns, silently undoing the warm-up on every retry.
        const fresh = await page
            .context()
            .cookies(EBAY_HOME_URL)
            .catch(() => []);
        if (session && fresh.length) session.setCookies(fresh, EBAY_HOME_URL);

        // `userData` is the Session's own scratch space; the flag is what keeps the
        // warm-up to once per session instead of once per request.
        // eslint-disable-next-line no-param-reassign
        if (session) session.userData.ebayWarmed = true;

        // Only recorded when the warm-up actually ran, so its cost is attributable per request.
        markPhase(request, 'warmUp');
    };
}

/** Closes off the navigation phase; runs before `logFailedNavigation` in the hook list. */
export const markNavigation: PlaywrightHook = async ({ request }) => {
    markPhase(request, 'navigate');
};

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
