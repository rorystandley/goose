module.exports = {
  apps: [
    {
      name: 'goose',
      script: './src/index.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'goose-scheduler',
      script: './src/scheduler-runner.js',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
