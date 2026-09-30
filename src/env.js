'use strict';

const path = require('node:path');

const ENV_FILE = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(__dirname, '..', '.env');

try {
  process.loadEnvFile(ENV_FILE);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

module.exports = { ENV_FILE };
