import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';
import {
    buildKey,
    detectBlockReason,
    isEbayItemUrl,
    isEbaySellerUrl,
    isHttpUrl,
    TRACKER_URL_PATTERNS,
    withDisableRedirect,
} from '../src/utils.js';

const ITEM_URL = 'https://www.ebay.com/itm/296977871958';

/** Stand-in for the body text of a genuine listing: long, and free of block markers. */
const REAL_PAGE_BODY = 'Vintage camera in excellent condition. '.repeat(200);

describe('buildKey', () => {
    it('produces a key accepted by the Apify key-value store', () => {
        const key = buildKey(ITEM_URL);
        expect(key).toMatch(/^[a-zA-Z0-9!_.'()-]+$/);
        expect(key.length).toBeLessThanOrEqual(256);
    });

    it('is stable per URL and unique across URLs', () => {
        expect(buildKey(ITEM_URL)).toBe(buildKey(ITEM_URL));
        expect(buildKey(ITEM_URL)).not.toBe(buildKey(`${ITEM_URL}?x=1`));
    });

    it('stays within the length limit for very long URLs', () => {
        const key = buildKey(`https://www.ebay.com/itm/${'a'.repeat(1000)}`);
        expect(key.length).toBeLessThanOrEqual(256);
    });

    it('does not leave a doubled separator before the hash', () => {
        // A URL ending in characters that all sanitize away used to yield `..._<hash>`.
        expect(buildKey('https://www.ebay.com/itm/1???')).not.toMatch(/__/);
    });
});

describe('url helpers', () => {
    it('recognises page types', () => {
        expect(isEbayItemUrl(ITEM_URL)).toBe(true);
        expect(isEbaySellerUrl('https://www.ebay.com/str/somestore')).toBe(true);
        expect(isEbaySellerUrl('https://www.ebay.com/usr/someseller')).toBe(true);
        expect(isEbayItemUrl('https://example.com/itm/1')).toBe(false);
        expect(isHttpUrl('ftp://example.com')).toBe(false);
    });

    it('matches the page type on the path, not anywhere in the URL', () => {
        // An unrelated site that merely mentions the eBay path must not be treated as eBay,
        // otherwise it triggers the eBay warm-up and readiness gates for nothing.
        expect(isEbayItemUrl('https://example.com/?ref=ebay.com/itm/123')).toBe(false);
        expect(isEbayItemUrl('https://www.ebay.com/sch/i.html?q=ebay.com/itm/1')).toBe(false);
        expect(isEbayItemUrl('https://notebay.com/itm/123')).toBe(false);
    });

    it('appends disableRedirect to record URLs', () => {
        expect(withDisableRedirect('https://api.apify.com/v2/key-value-stores/x/records/y')).toContain(
            '?disableRedirect=true',
        );
        expect(withDisableRedirect('https://api.apify.com/v2/records/y?a=1')).toContain('&disableRedirect=true');
    });

    it('exposes tracker patterns in the wildcard form CDP expects', () => {
        expect(TRACKER_URL_PATTERNS.length).toBeGreaterThan(0);
        for (const pattern of TRACKER_URL_PATTERNS) {
            expect(pattern.startsWith('*') && pattern.endsWith('*')).toBe(true);
        }
    });
});

describe('detectBlockReason', () => {
    it('flags anti-bot interstitials by title', () => {
        expect(detectBlockReason('Pardon Our Interruption', REAL_PAGE_BODY)).toMatch(/pardon our interruption/);
        expect(detectBlockReason('Access Denied', REAL_PAGE_BODY)).toMatch(/access denied/);
    });

    it('flags a short page carrying a block marker', () => {
        expect(detectBlockReason('eBay', 'Please verify you are a human to continue browsing. '.repeat(4))).toMatch(
            /verify you are a human/,
        );
    });

    it('flags a page that rendered nothing', () => {
        expect(detectBlockReason('', '')).toMatch(/no meaningful content/);
        expect(detectBlockReason('eBay', '   \n  ')).toMatch(/no meaningful content/);
    });

    it('passes a genuine listing through', () => {
        expect(detectBlockReason('Vintage camera | eBay', REAL_PAGE_BODY)).toBeNull();
    });

    it('does not flag a long listing that happens to mention a marker word', () => {
        // A real description can contain "captcha"; only short pages may be judged by body text.
        const body = `${REAL_PAGE_BODY} This lot includes a book about captcha systems.`;
        expect(detectBlockReason('Vintage camera | eBay', body)).toBeNull();
    });
});

describe('normalizeInput', () => {
    it('applies defaults', () => {
        const { urls, config, maxConcurrency, maxRequestsPerCrawl } = normalizeInput({ urls: [ITEM_URL] });
        expect(urls).toEqual([ITEM_URL]);
        expect(config).toMatchObject({
            fullPage: true,
            viewportWidth: 1920,
            viewportHeight: 1080,
            waitMs: 1000,
            blockTrackers: true,
            warmUpSession: true,
            // Off by default: capturing less than the whole page must be an explicit choice.
            maxHeightPx: 0,
        });
        expect(maxConcurrency).toBe(3);
        expect(maxRequestsPerCrawl).toBe(1000);
    });

    it('keeps remote URL-list sources instead of discarding them', () => {
        // The `requestListSources` editor produces these when the user links a file of URLs.
        const { urls, remoteSources } = normalizeInput({
            startUrls: [{ requestsFromUrl: 'https://example.com/urls.txt' }, { url: ITEM_URL }],
        });
        expect(urls).toEqual([ITEM_URL]);
        expect(remoteSources).toEqual([{ requestsFromUrl: 'https://example.com/urls.txt' }]);
    });

    it('accepts a run that only has remote sources', () => {
        expect(() =>
            normalizeInput({ startUrls: [{ requestsFromUrl: 'https://example.com/urls.txt' }] }),
        ).not.toThrow();
    });

    it('merges both URL fields, drops invalid ones and de-duplicates', () => {
        const { urls } = normalizeInput({
            urls: [ITEM_URL, 'not-a-url', ''],
            startUrls: [{ url: ITEM_URL }, { url: 'https://www.ebay.com/str/somestore' }],
        });
        expect(urls).toEqual([ITEM_URL, 'https://www.ebay.com/str/somestore']);
    });

    it('clamps out-of-range numbers', () => {
        const { config } = normalizeInput({
            urls: [ITEM_URL],
            viewportWidth: 99_999,
            viewportHeight: 1,
            waitMs: -5,
        });
        expect(config.viewportWidth).toBe(3840);
        expect(config.viewportHeight).toBe(240);
        expect(config.waitMs).toBe(0);
    });

    it('clamps maxHeightPx to what the browser can actually capture', () => {
        expect(normalizeInput({ urls: [ITEM_URL], maxHeightPx: 999_999 }).config.maxHeightPx).toBe(32_000);
        expect(normalizeInput({ urls: [ITEM_URL], maxHeightPx: -1 }).config.maxHeightPx).toBe(0);
    });

    it('allows the eBay warm-up to be switched off', () => {
        expect(normalizeInput({ urls: [ITEM_URL], warmUpSession: false }).config.warmUpSession).toBe(false);
    });

    it('throws when there is nothing to capture', () => {
        expect(() => normalizeInput(null)).toThrow(/No valid URLs/);
        expect(() => normalizeInput({ urls: ['javascript:alert(1)'] })).toThrow(/No valid URLs/);
    });
});
