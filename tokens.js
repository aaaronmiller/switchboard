// Token pricing module for Switchboard
// Prices in USD per million tokens (MTok)
// Sources: https://www.anthropic.com/pricing (as of early 2026)
//
// Usage:  estimateCostCents({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model })
//         → number (integer cents, 0 if model unknown)

const PRICING = {
  // Claude 4 series
  'claude-opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },

  // Claude 3.7 / 3.5 / 3
  'claude-3-7-sonnet': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-haiku': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  'claude-3-opus': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
};

// Fuzzy-match model ID to a pricing key (handles date suffixes and minor variants)
function resolveModel(modelId) {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  // Strip date suffix (e.g. -20241022, -20250219) and revision (e.g. -v1)
  const base = lower.replace(/-\d{8}$/, '').replace(/-v\d+$/, '');

  // Exact match first
  if (PRICING[base]) return base;

  // Prefix match: longest matching key wins
  let best = null;
  let bestLen = 0;
  for (const key of Object.keys(PRICING)) {
    if (base.startsWith(key) && key.length > bestLen) {
      best = key;
      bestLen = key.length;
    }
  }
  if (best) return best;

  // Fallback: check if any key is a substring of the model ID
  for (const key of Object.keys(PRICING)) {
    if (base.includes(key)) return key;
  }
  return null;
}

/**
 * Estimate cost in whole cents (integer) for a session's token usage.
 * Returns 0 if model is unknown.
 */
function estimateCostCents({ inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, model } = {}) {
  const key = resolveModel(model);
  if (!key) return 0;
  const p = PRICING[key];
  const usd =
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite;
  return Math.round(usd * 100);
}

/**
 * Format token count as a short human-readable string.
 * e.g. 1500 → "1.5k", 2000000 → "2.0M"
 */
function formatTokens(n) {
  if (!n || n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/**
 * Format cost in cents as a readable dollar amount.
 * e.g. 0 → null (don't show), 1 → "$0.01", 100 → "$1.00"
 */
function formatCost(cents) {
  if (!cents || cents === 0) return null;
  if (cents < 1) return '<$0.01';
  const dollars = cents / 100;
  if (dollars >= 1) return '$' + dollars.toFixed(2);
  return '$0.' + String(cents).padStart(2, '0');
}

module.exports = { estimateCostCents, formatTokens, formatCost, resolveModel, PRICING };
