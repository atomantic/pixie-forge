// =============================================================================
// PM2 Ecosystem Configuration - Pixie Forge
// =============================================================================
const path = require('path');
const LOG_DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS[Z]';
const IS_WIN = process.platform === 'win32';

const BASE_ENV = {
  NODE_ENV: 'development',
  TZ: 'UTC'
};

const PORTS = {
  API: 5570,  // Express API server
  UI: 5571    // Vite dev server (client)
};

module.exports = {
  PORTS,

  apps: [
    {
      name: 'pixie-server',
      script: 'server/index.js',
      cwd: __dirname,
      interpreter: 'node',
      log_date_format: LOG_DATE_FORMAT,
      windowsHide: IS_WIN,
      env: {
        ...BASE_ENV,
        PORT: PORTS.API,
        HOST: '0.0.0.0',
        PATH: process.env.PATH
      },
      watch: ['server'],
      watch_delay: 300000,
      ignore_watch: ['**/node_modules', '**/*.test.js', '**/*package-lock*'],
      max_memory_restart: '2G'
    },
    {
      name: 'pixie-ui',
      script: path.join(__dirname, 'client', 'node_modules', 'vite', 'bin', 'vite.js'),
      cwd: path.join(__dirname, 'client'),
      log_date_format: LOG_DATE_FORMAT,
      windowsHide: IS_WIN,
      args: `--host 0.0.0.0 --port ${PORTS.UI}`,
      env: {
        ...BASE_ENV,
        VITE_PORT: PORTS.UI,
        VITE_API_PORT: PORTS.API
      },
      watch: false
    }
  ]
};
