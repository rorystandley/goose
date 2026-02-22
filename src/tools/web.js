import fetch from 'node-fetch';
import config from '../config.js';

// --- Search provider implementations ---

async function searchBrave(query) {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
    {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.BRAVE_SEARCH_API_KEY,
      },
    }
  );
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data?.web?.results ?? []).map(r => ({
    title: r.title,
    snippet: r.description,
    url: r.url,
  }));
}

async function searchSerper(query) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': config.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 8 }),
  });
  if (!res.ok) throw new Error(`Serper API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data?.organic ?? []).map(r => ({
    title: r.title,
    snippet: r.snippet,
    url: r.link,
  }));
}

async function searchTavily(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: config.TAVILY_API_KEY, query, max_results: 8 }),
  });
  if (!res.ok) throw new Error(`Tavily API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data?.results ?? []).map(r => ({
    title: r.title,
    snippet: r.content,
    url: r.url,
  }));
}

// Format normalised results into a plain text string for the LLM
function formatResults(query, results) {
  if (!results.length) return `No results found for: "${query}"`;
  const lines = [`Search results for "${query}":\n`];
  for (const r of results) {
    lines.push(`• ${r.title}`);
    if (r.snippet) lines.push(`  ${r.snippet}`);
    lines.push(`  ${r.url}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export const web_search = {
  name: 'web_search',
  description: 'Search the web and return top results with titles, descriptions and URLs. Use this to find current information, news, documentation, or anything you need to look up online. Automatically uses whichever search API is configured (Brave, Serper, or Tavily).',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
    },
    required: ['query'],
  },
  execute: async ({ query }) => {
    try {
      // Use whichever provider has a key configured — first one wins
      if (config.BRAVE_SEARCH_API_KEY) {
        return formatResults(query, await searchBrave(query));
      }
      if (config.SERPER_API_KEY) {
        return formatResults(query, await searchSerper(query));
      }
      if (config.TAVILY_API_KEY) {
        return formatResults(query, await searchTavily(query));
      }
      return 'web_search is not configured. Add one of the following to your .env file:\n' +
        '  BRAVE_SEARCH_API_KEY  — https://api.search.brave.com/app/dashboard\n' +
        '  SERPER_API_KEY        — https://serper.dev (2,500 free Google results)\n' +
        '  TAVILY_API_KEY        — https://tavily.com (1,000 free req/month, built for AI)';
    } catch (err) {
      return `Search failed: ${err.message}`;
    }
  },
};

export const fetch_url = {
  name: 'fetch_url',
  description: 'Fetch the content of a URL and return it as plain text. HTML tags are stripped. Use this to read web pages, documentation, or any URL.',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
    },
    required: ['url'],
  },
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Goose-Agent/1.0' },
        redirect: 'follow',
      });
      const html = await res.text();
      // Strip script/style blocks then all HTML tags
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (text.length > 3000) {
        return text.slice(0, 3000) + '\n[Content truncated at 3000 characters]';
      }
      return text || '(Page returned no readable content)';
    } catch (err) {
      return `Failed to fetch URL: ${err.message}`;
    }
  },
};
