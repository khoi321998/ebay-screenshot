import { describe, expect, it } from 'vitest';

import { normalizeInput } from '../src/input.js';
import { buildKey, isEbayItemUrl, isEbaySellerUrl, isHttpUrl, withDisableRedirect } from '../src/utils.js';

const ITEM_URL = 'https://www.ebay.com/itm/296977871958';

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
});

describe('url helpers', () => {
    it('recognises page types', () => {
        expect(isEbayItemUrl(ITEM_URL)).toBe(true);
        expect(isEbaySellerUrl('https://www.ebay.com/str/somestore')).toBe(true);
        expect(isEbayItemUrl('https://example.com/itm/1')).toBe(false);
        expect(isHttpUrl('ftp://example.com')).toBe(false);
    });

    it('appends disableRedirect to record URLs', () => {
        expect(withDisableRedirect('https://api.apify.com/v2/key-value-stores/x/records/y')).toContain(
            '?disableRedirect=true',
        );
        expect(withDisableRedirect('https://api.apify.com/v2/records/y?a=1')).toContain('&disableRedirect=true');
    });
});

describe('normalizeInput', () => {
    it('applies defaults', () => {
        const { urls, config, maxConcurrency } = normalizeInput({ urls: [ITEM_URL] });
        expect(urls).toEqual([ITEM_URL]);
        expect(config).toMatchObject({
            fullPage: true,
            viewportWidth: 1920,
            viewportHeight: 1080,
            waitMs: 2000,
            format: 'png',
        });
        expect(maxConcurrency).toBe(3);
    });

    it('merges both URL fields, drops invalid ones and de-duplicates', () => {
        const { urls } = normalizeInput({
            urls: [ITEM_URL, 'not-a-url', ''],
            startUrls: [{ url: ITEM_URL }, { url: 'https://www.ebay.com/str/somestore' }],
        });
        expect(urls).toEqual([ITEM_URL, 'https://www.ebay.com/str/somestore']);
    });

    it('clamps out-of-range numbers and falls back on an unknown format', () => {
        const { config } = normalizeInput({
            urls: [ITEM_URL],
            viewportWidth: 99_999,
            waitMs: -5,
            format: 'webp',
            jpegQuality: 200,
        });
        expect(config.viewportWidth).toBe(3840);
        expect(config.waitMs).toBe(0);
        expect(config.format).toBe('png');
        expect(config.jpegQuality).toBe(100);
    });

    it('throws when there is nothing to capture', () => {
        expect(() => normalizeInput(null)).toThrow(/No valid URLs/);
        expect(() => normalizeInput({ urls: ['javascript:alert(1)'] })).toThrow(/No valid URLs/);
    });
});
