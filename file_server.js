if (process.env['config-file-path'] === undefined) {
  process.env['config-file-path'] = 'config.json';
}
// production file server needs this, can be removed in 2021
if (process.env['NPOMF_ROOT_SERVE_FILES'] === undefined) {
  process.env['NPOMF_ROOT_SERVE_FILES'] = true;
}
if (process.env['NPOMF_FILE_URL'] === undefined) {
// maybe if file_exists we trigger this
//  process.env['NPOMF_FILE_URL'] = 'https://file-static.lokinet.org/f';
}
const middlewares = require('./loki/middlewares.js');
var apps = require('./loki/server/app.js');

apps.publicApp.use(middlewares.snodeOnionMiddleware);
// Express 4.x specific
// position it to spot 2
apps.publicApp._router.stack.splice(2, 0, apps.publicApp._router.stack.splice(apps.publicApp._router.stack.length - 1, 1)[0]);
