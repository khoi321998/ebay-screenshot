import { log } from 'apify';

import type { Input, NormalizedInput, ScreenshotFormat } from './types.js';
import { isHttpUrl } from './utils.js';

const DEFAULTS = {
    fullPage: true,
    viewportWidth: 1920,
    viewportHeight: 1080,
    waitMs: 2000,
    format: 'png' as ScreenshotFormat,
    jpegQuality: 85,
    maxConcurrency: 3,
    maxRequestRetries: 5,
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Reads a positive integer, falling back to `fallback` when missing or invalid. */
function toInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return clamp(Math.round(value), min, max);
}

function collectUrls(input: Input): string[] {
    const sources = [...(input.urls ?? []), ...(input.startUrls ?? [])];
    const urls: string[] = [];

    for (const source of sources) {
        const url = typeof source === 'string' ? source : source?.url;
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
    return [...new Set(urls)];
}

/**
 * Validates the raw Actor input and fills in defaults.
 * Throws when no usable URL is left, since there would be nothing to capture.
 */
export function normalizeInput(input: Input | null): NormalizedInput {
    const raw = input ?? {};
    const urls = collectUrls(raw);

    if (!urls.length) {
        throw new Error('No valid URLs provided. Set input.urls = ["https://..."] or use Start URLs.');
    }

    const format: ScreenshotFormat = raw.format === 'jpeg' ? 'jpeg' : DEFAULTS.format;
    if (raw.format && raw.format !== 'jpeg' && raw.format !== 'png') {
        log.warning(`Unknown format "${raw.format}", falling back to "${DEFAULTS.format}".`);
    }

    return {
        urls,
        config: {
            fullPage: typeof raw.fullPage === 'boolean' ? raw.fullPage : DEFAULTS.fullPage,
            viewportWidth: toInt(raw.viewportWidth, DEFAULTS.viewportWidth, 320, 3840),
            viewportHeight: toInt(raw.viewportHeight, DEFAULTS.viewportHeight, 240, 4320),
            waitMs: toInt(raw.waitMs, DEFAULTS.waitMs, 0, 60_000),
            format,
            jpegQuality: toInt(raw.jpegQuality, DEFAULTS.jpegQuality, 1, 100),
        },
        maxConcurrency: toInt(raw.maxConcurrency, DEFAULTS.maxConcurrency, 1, 10),
        maxRequestRetries: toInt(raw.maxRequestRetries, DEFAULTS.maxRequestRetries, 0, 10),
    };
}
