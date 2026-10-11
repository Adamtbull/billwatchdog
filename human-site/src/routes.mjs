/**
 * The only paths the human layer answers. Every other path belongs to the existing
 * worker: handleHumanRequest returns null for it before doing any I/O.
 * Keep integration/routes-include.json in step with these patterns (a test checks).
 */
const PLAN = /^\/plans\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
const COMPARE = /^\/compare\/([A-Za-z0-9_-]+)\/?$/;
const CATEGORY = /^\/(vpn|streaming)\/?$/;
const DISCLOSURE = /^\/affiliate-disclosure\/?$/;

/**
 * Classify a pathname. "/" is human-owned only when the homepage switch is on, so with
 * the switch off the existing agent homepage keeps serving "/" untouched.
 */
export function matchHumanRoute(pathname, { homepage = false } = {}) {
  if (typeof pathname !== 'string') return null;
  if (pathname === '/') return homepage === true ? { kind: 'home' } : null;
  if (pathname.startsWith('/go/')) return { kind: 'go' };
  let match;
  if ((match = CATEGORY.exec(pathname))) return { kind: 'category', param: match[1] };
  if ((match = PLAN.exec(pathname))) return { kind: 'plan', param: match[1] };
  if ((match = COMPARE.exec(pathname))) return { kind: 'compare', param: match[1] };
  if (DISCLOSURE.test(pathname)) return { kind: 'disclosure' };
  return null;
}

export function ownsHumanRoute(pathname, options = {}) {
  return matchHumanRoute(pathname, options) !== null;
}
