import pkg from '@slack/bolt';
const { App } = pkg;
import config from '../../config.js';
import { registerCommandHandlers } from './commands.js';
import { registerMessageHandlers } from './messages.js';
import { registerInteractionHandlers } from './interactions.js';

const app = new App({
  token: config.SLACK_BOT_TOKEN,
  appToken: config.SLACK_APP_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
});

// Bolt hardcodes a 5-second ping timeout in the underlying SocketModeClient.
// On home networks / Mac minis this triggers false disconnects, dropping
// interactive events (approval button clicks) during the reconnection window.
// Increase to 30s before start() so the value propagates to the WebSocket.
if (app.receiver?.client) {
  app.receiver.client.clientPingTimeoutMS = 30_000;
}

registerCommandHandlers(app);
registerMessageHandlers(app);
registerInteractionHandlers(app);

export { app };
