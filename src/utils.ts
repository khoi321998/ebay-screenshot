import crypto from 'node:crypto';

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

/** Matches ebay.com and any subdomain of it, but not lookalikes such as notebay.com. */
const EBAY_HOST = /(?:^|\.)ebay\.com$/i;

export function isEbayHost(url: string): boolean {
    const parsed = parseUrl(url);
    return parsed !== null && EBAY_HOST.test(parsed.hostname);
}

/**
 * Page-type checks are matched against the *path* of an eBay host, so an unrelated
 * URL that merely mentions "ebay.com/itm/" in a query string is not misclassified.
 */
function isEbayPath(url: string, pattern: RegExp): boolean {
    const parsed = parseUrl(url);
    if (parsed === null || !EBAY_HOST.test(parsed.hostname)) return false;
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

/**
 * Third-party hosts that only serve analytics, ads and beacons. Blocking them cuts page
 * load time and - because the Actor runs on residential proxy billed per GB - real money.
 * Anything that can affect what the page *looks like* is deliberately absent from this list.
 */
const TRACKER_HOSTS = [
    'google-analytics.com',
    'googletagmanager.com',
    'googlesyndication.com',
    'doubleclick.net',
    'adservice.google.',
    'scorecardresearch.com',
    'criteo.com',
    'criteo.net',
    'facebook.net',
    'connect.facebook.com',
    'bat.bing.com',
    'hotjar.com',
    'newrelic.com',
    'nr-data.net',
    'branch.io',
    'omtrdc.net',
    'demdex.net',
    'rubiconproject.com',
    'pubmatic.com',
    'openx.net',
    'taboola.com',
    'outbrain.com',
];

/**
 * The same hosts as CDP `Network.setBlockedURLs` patterns. That API matches the whole URL,
 * so each host has to be wrapped in wildcards to match anywhere in the request URL.
 */
export const TRACKER_URL_PATTERNS = TRACKER_HOSTS.map((host) => `*${host}*`);
