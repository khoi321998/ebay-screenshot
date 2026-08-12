export type ScreenshotFormat = 'png' | 'jpeg';

/** Raw input as provided by the user - every field is optional and untrusted. */
export interface Input {
    /** Shorthand list of URLs, e.g. ["https://www.ebay.com/itm/296977871958"]. */
    urls?: (string | { url: string })[];
    /** Standard Apify request list sources; used when `urls` is empty. */
    startUrls?: (string | { url: string })[];
    fullPage?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
    waitMs?: number;
    format?: string;
    jpegQuality?: number;
    maxConcurrency?: number;
    maxRequestRetries?: number;
}

/** Per-page capture settings, resolved from the input and passed to the handler. */
export interface ScreenshotConfig {
    fullPage: boolean;
    viewportWidth: number;
    viewportHeight: number;
    waitMs: number;
    format: ScreenshotFormat;
    jpegQuality: number;
}

/** Input after validation and defaulting - safe to use without further checks. */
export interface NormalizedInput {
    urls: string[];
    config: ScreenshotConfig;
    maxConcurrency: number;
    maxRequestRetries: number;
}

/** Shape of a single dataset entry, mirroring Apify's Website Screenshot Generator. */
export interface ScreenshotResult {
    url: string;
    screenshotUrl: string | null;
    error?: string;
}
