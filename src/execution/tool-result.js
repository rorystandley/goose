/** Recognise failure envelopes returned by Goose's legacy string-based tools. */
export function isToolFailure(value) {
  const text = String(value).trim();
  return /^(error\b|failed to\b|tool execution error|access denied|command failed|search failed|backup failed|twitter api error|twitter credits depleted|rate limited by twitter|web_search is not configured)/i.test(text)
    || /^Backup saved to .+ but pruning failed:/i.test(text);
}
