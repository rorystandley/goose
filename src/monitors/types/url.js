/**
 * URL monitor — polls an HTTP endpoint at a configured interval.
 *
 * Triggers when:
 *   - The status code is >= 400 (or the request fails entirely)
 *   - The URL recovers (comes back to 2xx) after a previous failure
 *
 * Exported shape:
 *   { type: 'url', check(monitor) → { triggered, vars } }
 */

/**
 * Perform a single HTTP check for the given monitor config.
 * Returns { triggered, vars } where vars is the interpolation context.
 *
 * @param {object} monitor   - monitor config object
 * @param {object} state     - mutable state for this monitor (previousStatus)
 * @returns {{ triggered: boolean, vars: object }}
 */
export async function check(monitor, state = {}) {
  const { url } = monitor;
  let status = null;
  let error = null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    status = res.status;
  } catch (err) {
    error = err.message;
    status = 0; // treat network failure as status 0
  }

  const isDown = status === 0 || status >= 400;
  const wasDown = state.previousStatus === undefined
    ? false
    : (state.previousStatus === 0 || state.previousStatus >= 400);

  const recovered = wasDown && !isDown;
  const triggered = isDown || recovered;

  const vars = {
    url,
    status: status === 0 ? `network error (${error})` : String(status),
    error: error || '',
  };

  state.previousStatus = status;

  return { triggered, vars };
}

export const type = 'url';
