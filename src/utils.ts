import crypto from 'node:crypto';

/**
 * Build a key-value-store-safe key from a URL.
 * Apify keys must match /^[a-zA-Z0-9!_.'()-]+$/ and be at most 256 characters long,
 * so the URL is sanitized and suffixed with a hash to keep the key unique.
 */
export function buildKey(url: string): string {
    const sanitized = url.replace(/[^a-zA-Z0-9!_.'()-]+/g, '_').replace(/^_+|_+$/g, '');
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const prefix = `screenshot_${sanitized}`.slice(0, 200);
    return `${prefix}_${hash}`;
}

/**
 * Append `disableRedirect=true` so the record URL serves the image directly
 * instead of redirecting to a temporary storage location.
 */
export function withDisableRedirect(publicUrl: string): string {
    return publicUrl.includes('?') ? `${publicUrl}&disableRedirect=true` : `${publicUrl}?disableRedirect=true`;
}

/** Returns true only for absolute http(s) URLs, which is all the crawler can navigate to. */
export function isHttpUrl(url: string): boolean {
    try {
        const { protocol } = new URL(url);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

export function isEbayHost(url: string): boolean {
    try {
        return /(?:^|\.)ebay\.com$/i.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

export const isEbayItemUrl = (url: string): boolean => /ebay\.com\/itm\//i.test(url);
export const isEbaySellerUrl = (url: string): boolean => /ebay\.com\/(?:str|usr)\//i.test(url);
