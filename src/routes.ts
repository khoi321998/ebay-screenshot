import { createPlaywrightRouter } from '@crawlee/playwright';
import type { KeyValueStore } from 'apify';
import type { Page } from 'playwright';

import type { ScreenshotConfig, ScreenshotResult } from './types.js';
import { buildKey, isEbayItemUrl, isEbaySellerUrl, withDisableRedirect } from './utils.js';

const SELECTOR_TIMEOUT_MS = 20_000;

/** Scrolls the page to the bottom and back up so lazy-loaded images render before capture. */
async function triggerLazyLoading(page: Page): Promise<void> {
    await page
        .evaluate(async () => {
            await new Promise<void>((resolve) => {
                const step = 600;
                let total = 0;
                const timer = setInterval(() => {
                    window.scrollBy(0, step);
                    total += step;
                    if (total >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
            });
            window.scrollTo(0, 0);
        })
        .catch(() => undefined);
    await page.waitForTimeout(500);
}

export function createRouter(store: KeyValueStore, config: ScreenshotConfig) {
    const router = createPlaywrightRouter();
    const contentType = config.format === 'jpeg' ? 'image/jpeg' : 'image/png';

    router.addDefaultHandler(async ({ page, request, log, pushData }) => {
        const { url } = request;
        log.info(`Capturing screenshot: ${url}`);

        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
        // Skip networkidle - eBay never reaches it (analytics pings, lazy load), so we'd just
        // waste 15s. The selector waits below plus `waitMs` cover the settle time instead.

        // Site-specific readiness gates.
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

        if (config.fullPage) await triggerLazyLoading(page);
        if (config.waitMs > 0) await page.waitForTimeout(config.waitMs);

        const buffer =
            config.format === 'jpeg'
                ? await page.screenshot({
                      fullPage: config.fullPage,
                      type: 'jpeg',
                      quality: config.jpegQuality,
                  })
                : await page.screenshot({ fullPage: config.fullPage, type: 'png' });

        const key = buildKey(url);
        await store.setValue(key, buffer, { contentType });
        const screenshotUrl = withDisableRedirect(store.getPublicUrl(key));

        log.info(`Screenshot saved -> ${screenshotUrl}`);
        await pushData({ url, screenshotUrl } satisfies ScreenshotResult);
    });

    return router;
}
