if (process.env['config-file-path'] === undefined) {
  process.env['config-file-path'] = 'config.json';
}
require('./loki/server/app')
