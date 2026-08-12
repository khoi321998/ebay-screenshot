/**
 * A single entry of `urls` / `startUrls`.
 * The `requestListSources` editor lets users point at a remote file of URLs
 * (`requestsFromUrl`) instead of listing them inline, so both shapes are accepted.
 */
export interface UrlSource {
    url?: string;
    requestsFromUrl?: string;
    regex?: string;
    method?: string;
}

/** Proxy settings as produced by the `proxy` input editor. */
export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

/** Raw input as provided by the user - every field is optional and untrusted. */
export interface Input {
    /** Shorthand list of URLs, e.g. ["https://www.ebay.com/itm/296977871958"]. */
    urls?: (string | UrlSource)[];
    /** Standard Apify request list sources; merged with `urls`. */
    startUrls?: (string | UrlSource)[];
    fullPage?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
    waitMs?: number;
    maxHeightPx?: number;
    maxConcurrency?: number;
    maxRequestRetries?: number;
    maxRequestsPerCrawl?: number;
    blockTrackers?: boolean;
    warmUpSession?: boolean;
    proxyConfiguration?: ProxyInput;
}

/** Per-page capture settings, resolved from the input and passed to the handler. */
export interface ScreenshotConfig {
    fullPage: boolean;
    viewportWidth: number;
    viewportHeight: number;
    waitMs: number;
    /** Hard cap on captured height in pixels; 0 means "as tall as the page is". */
    maxHeightPx: number;
    blockTrackers: boolean;
    warmUpSession: boolean;
}

/** Input after validation and defaulting - safe to use without further checks. */
export interface NormalizedInput {
    urls: string[];
    /** Entries that still need to be downloaded and expanded into URLs. */
    remoteSources: UrlSource[];
    config: ScreenshotConfig;
    maxConcurrency: number;
    maxRequestRetries: number;
    maxRequestsPerCrawl: number;
    proxyConfiguration?: ProxyInput;
}

/** Shape of a single dataset entry, mirroring Apify's Website Screenshot Generator. */
export interface ScreenshotResult {
    url: string;
    screenshotUrl: string | null;
    error?: string;
}
