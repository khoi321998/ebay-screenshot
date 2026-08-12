import type { Request } from '@crawlee/playwright';

/**
 * Per-request phase timings.
 *
 * A capture is spread across the pre-navigation hook, Crawlee's own navigation, the
 * post-navigation hook and the request handler, so the running total has to live somewhere
 * all of them can reach - which is the Request's `userData`.
 */
interface TimingState {
    phases: Record<string, number>;
    last: number;
    start: number;
}

function getState(request: Request): TimingState | undefined {
    return request.userData?.timings as TimingState | undefined;
}

/** Starts (or, on a retry, restarts) measurement for this attempt. */
export function resetTiming(request: Request): void {
    const now = Date.now();
    request.userData.timings = { phases: {}, last: now, start: now } satisfies TimingState;
}

/** Records the time elapsed since the previous mark under `phase`. */
export function markPhase(request: Request, phase: string): void {
    const state = getState(request);
    if (!state) return;
    const now = Date.now();
    state.phases[phase] = now - state.last;
    state.last = now;
}

/** All recorded phases plus the total, in milliseconds, ready to hand to a logger. */
export function phaseSummary(request: Request): Record<string, number> {
    const state = getState(request);
    if (!state) return {};
    return { ...state.phases, totalMs: Date.now() - state.start };
}
