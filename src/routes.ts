import { createPlaywrightRouter } from '@crawlee/playwright';
import type { KeyValueStore, Log } from 'apify';
import type { Page } from 'playwright';

import { markPhase, phaseSummary } from './timing.js';
import type { ScreenshotConfig, ScreenshotResult } from './types.js';
import {
    buildKey,
    detectBlockReason,
    isEbayHost,
    isEbayItemUrl,
    isEbaySellerUrl,
    withDisableRedirect,
} from './utils.js';

const SELECTOR_TIMEOUT_MS = 20_000;

/** Playwright hard-fails above 32767px on any dimension; stay clear of the edge. */
const MAX_SCREENSHOT_PX = 32_000;

/**
 * Captures are always PNG. The Actor's purpose is preserving what a listing looked like,
 * and lossless output is the right default for evidence; a quality knob would only invite
 * people to weaken that for a saving the measurements showed to be small.
 */
const CONTENT_TYPE = 'image/png';

type ScreenshotOptions = NonNullable<Parameters<Page['screenshot']>[0]>;

interface PageSize {
    width: number;
    height: number;
}

/**
 * Scrolls the page to the bottom and back up so lazy-loaded images render before capture,
 * and reports the resulting document size so the capture step does not need its own round
 * trip into the browser to measure it.
 *
 * Steps by a full viewport rather than a fixed 600px so tall pages finish in a few seconds,
 * and stops on the real scroll position - a page that grows while scrolling would otherwise
 * make the loop exit early and leave the lower half unrendered.
 */
async function triggerLazyLoading(page: Page, viewportHeight: number): Promise<PageSize | null> {
    const size = await page
        .evaluate(async (step) => {
            const MAX_STEPS = 200;
            await new Promise<void>((resolve) => {
                let steps = 0;
                const timer = setInterval(() => {
                    window.scrollBy(0, step);
                    steps += 1;
                    const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
                    if (bottom || steps >= MAX_STEPS) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
            window.scrollTo(0, 0);
            return {
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
            };
        }, viewportHeight)
        .catch(() => null);

    await page.waitForTimeout(400);
    return size;
}

/**
 * Captures the page, clamping the capture area to `maxHeightPx` and to what Playwright can
 * physically encode. Without the clamp an unusually long page throws and burns every retry.
 */
async function capture(page: Page, config: ScreenshotConfig, log: Log, knownSize: PageSize | null): Promise<Buffer> {
    const options: ScreenshotOptions = { type: 'png', fullPage: config.fullPage };

    if (config.fullPage) {
        const size =
            knownSize ??
            (await page
                .evaluate(() => ({
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                }))
                .catch(() => null));

        // A user-set cap is an intentional crop; the platform cap is a last-resort rescue.
        const heightLimit =
            config.maxHeightPx > 0 ? Math.min(config.maxHeightPx, MAX_SCREENSHOT_PX) : MAX_SCREENSHOT_PX;

        if (size && (size.height > heightLimit || size.width > MAX_SCREENSHOT_PX)) {
            if (size.height > MAX_SCREENSHOT_PX || size.width > MAX_SCREENSHOT_PX) {
                log.warning(
                    `Page is ${size.width}x${size.height}px, beyond the ${MAX_SCREENSHOT_PX}px the browser can capture - saving the top-left region.`,
                );
            } else {
                log.debug(`Trimming capture from ${size.height}px to maxHeightPx=${config.maxHeightPx}.`);
            }
            options.clip = {
                x: 0,
                y: 0,
                width: Math.min(size.width, MAX_SCREENSHOT_PX),
                height: Math.min(size.height, heightLimit),
            };
        }
    }

    return page.screenshot(options);
}

export function createRouter(store: KeyValueStore, config: ScreenshotConfig) {
    const router = createPlaywrightRouter();

    router.addDefaultHandler(async ({ page, request, session, log, pushData }) => {
        const { url } = request;
        log.info(`Capturing screenshot: ${url}`);

        // Site-specific readiness gates. Navigation stops at `domcontentloaded` (see hooks),
        // so these waits - plus `waitMs` - are what actually cover the settle time.
        if (isEbayItemUrl(url)) {
            await page
                .waitForSelector('h1.x-item-title__mainTitle, div.x-price-primary', {
                    timeout: SELECTOR_TIMEOUT_MS,
                })
                .catch(() => log.warning('eBay item: title/price not rendered within 20s'));
        } else if (isEbaySellerUrl(url)) {
            await page
                .waitForSelector('article.str-item-card, .str-seller-card, h1', {
                    timeout: SELECTOR_TIMEOUT_MS,
                })
                .catch(() => log.warning('eBay seller: no card/items rendered'));
        }
        markPhase(request, 'readyGate');

        // Akamai serves its challenge pages with HTTP 200, so a status check never sees them.
        // Without this the Actor would happily screenshot a captcha and report it as success.
        // Restricted to eBay: a sparse page on an arbitrary site is legitimate content.
        if (isEbayHost(url)) {
            const info = await page
                .evaluate(() => ({ title: document.title, text: document.body?.innerText ?? '' }))
                .catch(() => ({ title: '', text: '' }));

            const blockReason = detectBlockReason(info.title, info.text);
            if (blockReason) {
                // Retire so the retry gets a different proxy IP and a clean cookie jar.
                session?.retire();
                throw new Error(`Anti-bot page detected (${blockReason})`);
            }
            markPhase(request, 'blockCheck');
        }

        const pageSize = config.fullPage ? await triggerLazyLoading(page, config.viewportHeight) : null;
        markPhase(request, 'lazyLoad');

        if (config.waitMs > 0) await page.waitForTimeout(config.waitMs);
        markPhase(request, 'settle');

        const buffer = await capture(page, config, log, pageSize);
        markPhase(request, 'screenshot');

        const key = buildKey(url);
        await store.setValue(key, buffer, { contentType: CONTENT_TYPE });
        markPhase(request, 'upload');
        const screenshotUrl = withDisableRedirect(store.getPublicUrl(key));

        log.info(`Screenshot saved (${Math.round(buffer.length / 1024)} kB) -> ${screenshotUrl}`);
        // Phase breakdown in milliseconds - the only reliable way to know where a capture
        // actually spends its time before changing anything to make it faster.
        log.info(`Timing ${url}`, {
            ...phaseSummary(request),
            pageWidth: pageSize?.width ?? null,
            pageHeight: pageSize?.height ?? null,
            bytes: buffer.length,
        });
        await pushData({ url, screenshotUrl } satisfies ScreenshotResult);
    });

    return router;
}
