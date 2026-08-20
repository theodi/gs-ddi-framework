/**
 * AI is off in the static prototype. When a backend exists, set AI_API_BASE
 * to that origin and restore authentication there. Assessments stay in
 * localStorage; the API is only for coaching / prefill / re-scope.
 */
export const AI_API_BASE = null;

export function isAiApiConfigured() {
  return Boolean(AI_API_BASE);
}
