import crypto from 'node:crypto';

import { isEbayUrl } from './ebay-sites.js';

/**
 * Build a key-value-store-safe key from a URL.
 * Apify keys must match /^[a-zA-Z0-9!_.'()-]+$/ and be at most 256 characters long,
 * so the URL is sanitized and suffixed with a hash to keep the key unique.
 */
export function buildKey(url: string): string {
    const sanitized = url.replace(/[^a-zA-Z0-9!_.'()-]+/g, '_').replace(/^_+|_+$/g, '');
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const prefix = `screenshot_${sanitized}`.slice(0, 200).replace(/_+$/, '');
    return `${prefix}_${hash}`;
}

/**
 * Append `disableRedirect=true` so the record URL serves the image directly
 * instead of redirecting to a temporary storage location.
 */
export function withDisableRedirect(publicUrl: string): string {
    return publicUrl.includes('?') ? `${publicUrl}&disableRedirect=true` : `${publicUrl}?disableRedirect=true`;
}

/** Parses a URL, returning null instead of throwing so callers can stay expression-shaped. */
function parseUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

/** Returns true only for absolute http(s) URLs, which is all the crawler can navigate to. */
export function isHttpUrl(url: string): boolean {
    const parsed = parseUrl(url);
    return parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

/**
 * True for every eBay marketplace - ebay.com, ebay.es, ebay.co.uk, benl.ebay.be and so on -
 * but not for lookalikes such as notebay.com. See `ebay-sites.ts` for the full registry.
 */
export const isEbayHost = isEbayUrl;

/**
 * Page-type checks are matched against the *path* of an eBay host, so an unrelated
 * URL that merely mentions "ebay.com/itm/" in a query string is not misclassified.
 */
function isEbayPath(url: string, pattern: RegExp): boolean {
    const parsed = parseUrl(url);
    if (parsed === null || !isEbayUrl(url)) return false;
    return pattern.test(parsed.pathname);
}

export const isEbayItemUrl = (url: string): boolean => isEbayPath(url, /^\/itm\//i);
export const isEbaySellerUrl = (url: string): boolean => isEbayPath(url, /^\/(?:str|usr)\//i);

/**
 * Phrases that appear on anti-bot interstitials (Akamai, eBay's own challenge pages).
 * These are matched case-insensitively against the page title and body text.
 */
const BLOCK_MARKERS = [
    'pardon our interruption',
    'checking your browser',
    'access denied',
    'access to this page has been denied',
    'verify you are a human',
    'are you a human',
    'unusual traffic',
    'suspicious activity',
    'security challenge',
    'request blocked',
    'captcha',
];

/** Body text shorter than this means there is no real content - i.e. an interstitial. */
const EMPTY_BODY_CHARS = 150;

/**
 * A challenge page carries little text; a genuine listing carries thousands of characters.
 * Only treat a marker found in the body as a block when the page is small overall, so a
 * listing description that happens to contain e.g. "captcha" is not thrown away.
 */
const SHORT_BODY_CHARS = 2000;

/**
 * Detects an anti-bot interstitial served with HTTP 200.
 * Returns a human-readable reason, or null when the page looks like real content.
 */
export function detectBlockReason(title: string, bodyText: string): string | null {
    const normalizedTitle = title.toLowerCase();
    const body = bodyText.trim();
    const normalizedBody = body.toLowerCase();

    const titleMarker = BLOCK_MARKERS.find((marker) => normalizedTitle.includes(marker));
    if (titleMarker) return `blocked page title contains "${titleMarker}"`;

    if (body.length < EMPTY_BODY_CHARS) return 'page rendered no meaningful content';

    if (body.length < SHORT_BODY_CHARS) {
        const bodyMarker = BLOCK_MARKERS.find((marker) => normalizedBody.includes(marker));
        if (bodyMarker) return `short page containing "${bodyMarker}"`;
    }

    return null;
}
