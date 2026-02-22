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

registerCommandHandlers(app);
registerMessageHandlers(app);
registerInteractionHandlers(app);

export { app };
