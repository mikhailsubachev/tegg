// Resolve hook for helpers/l6-guard.ts: `webdriverio` imported from the test files resolves to helpers/l6-clicks.ts,
// which imports the real module itself.
const CLICKS = new URL('./l6-clicks.ts', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'webdriverio' && context.parentURL !== CLICKS) return { url: CLICKS, shortCircuit: true };
  return next(specifier, context);
}
