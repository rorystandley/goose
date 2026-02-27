import http from 'node:http';
import config from '../../config.js';
import { createLogger } from '../../logger.js';
import { handleRequest } from './handlers.js';

const log = createLogger('web');

let server = null;

/**
 * Start the web UI HTTP server.
 * Returns the http.Server instance, or null if WEB_ENABLED is false.
 */
export async function startWebServer() {
  if (!config.WEB_ENABLED) {
    log.info('Web UI disabled (set WEB_ENABLED=true to activate)');
    return null;
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      log.error('Unhandled request error', { error: err.message });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(config.WEB_PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  log.info(`Web UI ready`, { url: `http://localhost:${config.WEB_PORT}` });
  return server;
}

/**
 * Gracefully stop the web UI server.
 */
export async function stopWebServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  log.info('Web UI stopped');
}
