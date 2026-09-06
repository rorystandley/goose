/** HTML shell for the locally bundled React dashboard. */
export function getHtml(agentName, model, kanbanPollInterval = 60000) {
  const title = String(agentName).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // JSON lives inside a script element: escape HTML delimiters as well as JSON.
  const bootstrap = JSON.stringify({ agentName, model, kanbanPollInterval }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#101512">
  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="stylesheet" href="/app.css">
  <title>${title} — Mission Control</title>
</head>
<body>
  <div id="app"></div>
  <noscript>Enable JavaScript to use Goose Mission Control.</noscript>
  <script>window.__GOOSE = ${bootstrap};</script>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}
