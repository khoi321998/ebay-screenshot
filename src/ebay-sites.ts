/*
eBay marketplace registry.

Mirrored from the sibling `ebay-data-scraper` Actor so the two stay in sync — edit both, or neither.

eBay runs one codebase behind many country domains (ebay.com, ebay.es, ebay.de, …). The DOM is
identical across all of them, but the UI language, the number format and the currency the page
defaults to are not. Nothing in the page states which marketplace we are on in a machine-readable
way — the hostname is the only reliable signal — so every locale-dependent decision resolves here.

For this Actor that means two things: the proxy exits in the marketplace's own country (a US IP on
ebay.es gets a page quoting US delivery and USD prices, which is not the listing a Spanish buyer
sees), and the anti-bot warm-up hits the same origin the capture is headed for, because eBay sets
its Akamai cookies per domain — ebay.com never issues cookies valid on .ebay.es.

The rule everywhere else in the codebase: never hard-code `www.ebay.com`. Derive the origin from the
URL being handled.
*/

export interface EbaySite {
    /** Canonical hostname, e.g. `www.ebay.es`. */
    host: string;
    /** `https://www.ebay.es` — the warm-up target and the base for any relative URL. */
    origin: string;
    /** Domain suffix after `ebay.`, e.g. `es`, `co.uk`, `com.au`. */
    tld: string;
    /** UI language the site renders in — drives the Accept-Language header. */
    lang: string;
    /** ISO 3166-1 alpha-2 of the marketplace; also the proxy exit country. */
    countryCode: string;
    /** ISO 4217 the marketplace prices in. Unused here; kept so the registry matches the scraper's. */
    currency: string;
}

function site(host: string, tld: string, lang: string, countryCode: string, currency: string): EbaySite {
    return { host, origin: `https://${host}`, tld, lang, countryCode, currency };
}

/**
 * Ordered so `www.ebay.com` is first — it is the fallback for any host we do not recognise.
 * Regional-language hosts (benl/befr/cafr) are listed explicitly because their language differs
 * from the one the bare TLD implies.
 */
const SITES: EbaySite[] = [
    site('www.ebay.com', 'com', 'en', 'US', 'USD'),
    site('www.ebay.co.uk', 'co.uk', 'en', 'GB', 'GBP'),
    site('www.ebay.de', 'de', 'de', 'DE', 'EUR'),
    site('www.ebay.fr', 'fr', 'fr', 'FR', 'EUR'),
    site('www.ebay.it', 'it', 'it', 'IT', 'EUR'),
    site('www.ebay.es', 'es', 'es', 'ES', 'EUR'),
    site('www.ebay.at', 'at', 'de', 'AT', 'EUR'),
    site('www.ebay.ch', 'ch', 'de', 'CH', 'CHF'),
    site('www.ebay.nl', 'nl', 'nl', 'NL', 'EUR'),
    site('www.ebay.be', 'be', 'nl', 'BE', 'EUR'),
    site('benl.ebay.be', 'be', 'nl', 'BE', 'EUR'),
    site('befr.ebay.be', 'be', 'fr', 'BE', 'EUR'),
    site('www.ebay.ie', 'ie', 'en', 'IE', 'EUR'),
    site('www.ebay.pl', 'pl', 'pl', 'PL', 'PLN'),
    site('www.ebay.com.au', 'com.au', 'en', 'AU', 'AUD'),
    site('www.ebay.ca', 'ca', 'en', 'CA', 'CAD'),
    site('www.cafr.ebay.ca', 'ca', 'fr', 'CA', 'CAD'),
    site('www.ebay.com.hk', 'com.hk', 'zh', 'HK', 'HKD'),
    site('www.ebay.com.sg', 'com.sg', 'en', 'SG', 'SGD'),
    site('www.ebay.com.my', 'com.my', 'en', 'MY', 'MYR'),
    site('www.ebay.ph', 'ph', 'en', 'PH', 'PHP'),
    site('www.ebay.in', 'in', 'en', 'IN', 'INR'),
    site('www.ebay.com.mx', 'com.mx', 'es', 'MX', 'MXN'),
    site('www.ebay.co.jp', 'co.jp', 'ja', 'JP', 'JPY'),
];

export const DEFAULT_SITE = SITES[0];

const BY_HOST = new Map(SITES.map((s) => [s.host, s]));
/** First entry wins, so the `www.` host is what a bare TLD resolves to. */
const BY_TLD = new Map<string, EbaySite>();
for (const s of SITES) if (!BY_TLD.has(s.tld)) BY_TLD.set(s.tld, s);

/** True for any host on an eBay marketplace domain, known TLD or not. */
export function isEbayUrl(url: string): boolean {
    try {
        return /(?:^|\.)ebay\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Marketplace for `url`, or `null` when the host is not an eBay domain we know.
 * Subdomains we have no explicit entry for (`m.ebay.es`, `www.ebay.es.`) fall back to the TLD match,
 * but keep their own origin so navigation stays on the exact host the user gave us.
 */
export function resolveSite(url: string): EbaySite | null {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
        return null;
    }

    const exact = BY_HOST.get(host);
    if (exact) return exact;

    const suffix = host.match(/(?:^|\.)ebay\.([a-z.]+)$/i)?.[1];
    if (!suffix) return null;
    const byTld = BY_TLD.get(suffix);
    if (!byTld) return null;

    // Same marketplace, different host (m.ebay.es, ebay.es without www) — keep the caller's host so
    // we never bounce the capture onto a hostname eBay did not hand us.
    return host === byTld.host ? byTld : { ...byTld, host, origin: `https://${host}` };
}

/**
 * `resolveSite` with the ebay.com fallback applied — for call sites that must have a site.
 * Non-eBay URLs land on the default too, which is what keeps a plain website capture behaving
 * exactly as it did before the registry existed: US proxy, `en-US` headers, no warm-up.
 */
export function siteFor(url: string): EbaySite {
    return resolveSite(url) ?? DEFAULT_SITE;
}

/** `es` → `es-ES,es;q=0.9,en;q=0.8` — keeps the Accept-Language header coherent with the domain. */
export function acceptLanguageFor(s: EbaySite): string {
    const primary = `${s.lang}-${s.countryCode}`;
    return s.lang === 'en' ? `${primary},${s.lang};q=0.9` : `${primary},${s.lang};q=0.9,en;q=0.8`;
}
