const config = require('../config');
const JsonStore = require('./json-store');
const PgStore = require('./pg-store');

let store;
if (config.databaseUrl) {
  store = new PgStore(config);
  console.log('[storage] Using PostgreSQL');
} else {
  store = new JsonStore(config.dataFile);
  console.log('[storage] Using local JSON persistence at', config.dataFile);
}

module.exports = store;
