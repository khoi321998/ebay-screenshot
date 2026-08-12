import { RequestList } from '@crawlee/playwright';
import { log } from 'apify';

import type { Input, NormalizedInput, UrlSource } from './types.js';
import { isHttpUrl } from './utils.js';

const DEFAULTS = {
    fullPage: true,
    viewportWidth: 1920,
    viewportHeight: 1080,
    // The readiness gates already prove the page rendered, so this is only settle time.
    waitMs: 1000,
    maxHeightPx: 0,
    blockTrackers: true,
    warmUpSession: true,
    maxConcurrency: 3,
    maxRequestRetries: 5,
    maxRequestsPerCrawl: 1000,
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Reads a positive integer, falling back to `fallback` when missing or invalid. */
function toInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return clamp(Math.round(value), min, max);
}

interface CollectedUrls {
    urls: string[];
    remoteSources: UrlSource[];
}

function collectUrls(input: Input): CollectedUrls {
    const sources = [...(input.urls ?? []), ...(input.startUrls ?? [])];
    const urls: string[] = [];
    const remoteSources: UrlSource[] = [];

    for (const source of sources) {
        if (typeof source === 'string') {
            const trimmed = source.trim();
            if (!trimmed) {
                log.softFail('Skipping empty input entry');
            } else if (!isHttpUrl(trimmed)) {
                log.softFail('Skipping non-HTTP(S) URL', { url: trimmed });
            } else {
                urls.push(trimmed);
            }
            continue;
        }

        // The `requestListSources` editor offers "link to a file with URLs"; those entries
        // carry `requestsFromUrl` instead of `url` and are expanded later, over the network.
        if (source?.requestsFromUrl) {
            remoteSources.push(source);
            continue;
        }

        const url = source?.url;
        if (typeof url !== 'string' || !url.trim()) {
            log.softFail('Skipping input entry without a URL', { entry: source });
            continue;
        }
        const trimmed = url.trim();
        if (!isHttpUrl(trimmed)) {
            log.softFail('Skipping non-HTTP(S) URL', { url: trimmed });
            continue;
        }
        urls.push(trimmed);
    }

    // De-duplicate; the same URL would overwrite the same key-value-store record anyway.
    return { urls: [...new Set(urls)], remoteSources };
}

/**
 * Downloads every `requestsFromUrl` source and returns the URLs found inside.
 * Crawlee's RequestList already implements the download + regex extraction, so it is
 * reused here rather than reimplemented.
 */
export async function expandRemoteSources(remoteSources: UrlSource[]): Promise<string[]> {
    if (!remoteSources.length) return [];

    const urls: string[] = [];
    try {
        // `regex` arrives from the input form as a string; RequestList wants a real RegExp.
        // `method` is intentionally dropped - only GET pages can be screenshotted.
        const sources = remoteSources.map((source) => ({
            requestsFromUrl: source.requestsFromUrl!,
            ...(source.regex ? { regex: new RegExp(source.regex) } : {}),
        }));
        const list = await RequestList.open(null, sources);
        let request = await list.fetchNextRequest();
        while (request) {
            if (isHttpUrl(request.url)) urls.push(request.url);
            await list.markRequestHandled(request);
            request = await list.fetchNextRequest();
        }
    } catch (err) {
        log.warning('Failed to expand remote URL list, continuing without it', {
            error: (err as Error).message,
        });
        return [];
    }

    log.info(`Expanded ${remoteSources.length} remote source(s) into ${urls.length} URL(s)`);
    return urls;
}

/**
 * Validates the raw Actor input and fills in defaults.
 * Throws when there is nothing at all to capture, since the run would be pointless.
 * Note that remote sources are resolved separately - they may still yield URLs.
 */
export function normalizeInput(input: Input | null): NormalizedInput {
    const raw = input ?? {};
    const { urls, remoteSources } = collectUrls(raw);

    if (!urls.length && !remoteSources.length) {
        throw new Error('No valid URLs provided. Set input.urls = ["https://..."] or use Start URLs.');
    }

    return {
        urls,
        remoteSources,
        config: {
            fullPage: typeof raw.fullPage === 'boolean' ? raw.fullPage : DEFAULTS.fullPage,
            viewportWidth: toInt(raw.viewportWidth, DEFAULTS.viewportWidth, 320, 3840),
            viewportHeight: toInt(raw.viewportHeight, DEFAULTS.viewportHeight, 240, 4320),
            waitMs: toInt(raw.waitMs, DEFAULTS.waitMs, 0, 60_000),
            maxHeightPx: toInt(raw.maxHeightPx, DEFAULTS.maxHeightPx, 0, 32_000),
            blockTrackers: typeof raw.blockTrackers === 'boolean' ? raw.blockTrackers : DEFAULTS.blockTrackers,
            warmUpSession: typeof raw.warmUpSession === 'boolean' ? raw.warmUpSession : DEFAULTS.warmUpSession,
        },
        maxConcurrency: toInt(raw.maxConcurrency, DEFAULTS.maxConcurrency, 1, 10),
        maxRequestRetries: toInt(raw.maxRequestRetries, DEFAULTS.maxRequestRetries, 0, 10),
        maxRequestsPerCrawl: toInt(raw.maxRequestsPerCrawl, DEFAULTS.maxRequestsPerCrawl, 1, 1_000_000),
        proxyConfiguration: raw.proxyConfiguration,
    };
}
