import type { PlaywrightHook } from '@crawlee/playwright';

import { acceptLanguageFor, siteFor } from './ebay-sites.js';
import { markPhase, resetTiming } from './timing.js';
import type { ScreenshotConfig } from './types.js';
import { isEbayHost } from './utils.js';

/**
 * Sets up the viewport, request headers and light anti-automation patches, then warms the
 * session against the marketplace the request is headed for, so Akamai issues a real session
 * cookie before we hit /itm/. The warm-up is not optional: without it item pages were measured
 * returning HTTP 403 on every attempt.
 *
 * Which origin gets warmed follows the request's own hostname. eBay scopes its cookies per
 * domain - a cookie issued by ebay.com is never sent to .ebay.es - so warming a hard-coded
 * ebay.com would leave every non-US capture just as cold as no warm-up at all.
 *
 * The warm-up costs a full extra page load, so it runs once per session *per marketplace*
 * rather than once per request: with `useIncognitoPages` each page starts cookie-free and
 * Crawlee re-applies the session's cookie jar, so a session already warm for a host stays warm.
 * A retry always warms again - the previous attempt's cookies are exactly the ones Akamai just
 * rejected.
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

        const site = siteFor(request.url);

        await page.setViewportSize({
            width: config.viewportWidth,
            height: config.viewportHeight,
        });

        await page.setExtraHTTPHeaders({
            // Must agree with the domain. An `en-US` header on ebay.es is an odd pairing that
            // costs fingerprint coherence on a page eBay serves in Spanish either way. Non-eBay
            // URLs resolve to the default site, so they keep the previous `en-US` behaviour.
            'Accept-Language': acceptLanguageFor(site),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
        });

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            (window as unknown as Record<string, unknown>).chrome = { runtime: {} };
        });

        markPhase(request, 'setup');

        if (!isEbayHost(request.url)) return;

        const isRetry = request.retryCount > 0;
        // Keyed by host: a session warmed on ebay.com holds nothing usable for ebay.de.
        const warmedHosts = (session?.userData?.ebayWarmedHosts ?? {}) as Record<string, boolean>;
        if (warmedHosts[site.host] === true && !isRetry) return;

        if (isRetry) {
            // Drop whatever the failed attempt collected before asking for a fresh cookie.
            await page
                .context()
                .clearCookies()
                .catch(() => undefined);
        }

        log.debug(`Warming eBay session on ${site.host}${isRetry ? ' (retry)' : ''}: ${request.url}`);
        // `commit` resolves as soon as the response arrives, which is when Akamai's Set-Cookie
        // headers land - waiting for the full homepage DOM costs ~12s and buys nothing. The
        // sleep afterwards is the part that matters: it lets the sensor script run and turn
        // `_abck` into a valid token. Skipping the warm-up entirely returns 403, so it stays.
        await page.goto(site.origin, { waitUntil: 'commit', timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(1500 + Math.random() * 1000);

        // Hand the freshly issued cookies to the Session. This warm-up is a manual `goto`,
        // so Crawlee never sees its response and the session would keep serving the cookies
        // from the *previous* attempt - which `_applyCookies` then writes over the new ones
        // right after this hook returns, silently undoing the warm-up on every retry.
        const fresh = await page
            .context()
            .cookies(site.origin)
            .catch(() => []);
        if (session && fresh.length) session.setCookies(fresh, site.origin);

        // `userData` is the Session's own scratch space; the map is what keeps the warm-up to
        // once per marketplace per session instead of once per request.
        // eslint-disable-next-line no-param-reassign
        if (session) session.userData.ebayWarmedHosts = { ...warmedHosts, [site.host]: true };

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
