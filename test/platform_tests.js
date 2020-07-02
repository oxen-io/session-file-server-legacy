const path = require('path')
const assert = require('assert')
const lokinet = require('loki-launcher/lokinet')
const URL = require('url').URL // node 8.x backfill

if (process.env['config-file-path'] === undefined) {
  process.env['config-file-path'] = 'config.json';
}
const configUtil = require('../loki/server/lib/lib.config.js')
const nconf = configUtil.nconf

//require('longjohn')

const ADN_SCOPES = 'stream'

// Look for a config file
// const config_path = path.join(__dirname, '/../config.json')
// and a model file
//const config_model_path = path.join(__dirname, '/config.models.json')
// nconf.argv().env('__').file({file: config_path})
//.file('model', {file: config_model_path})

const cache = require('../loki/server/dataaccess/dataaccess.proxy-admin')
cache.start(nconf)
cache.dispatcher = {
  // ignore local user updates
  updateUser: (user, ts, cb) => { cb(false, user) },
  // ignore local message updates
  setMessage: (message, cb) => { if (cb) cb(false, message) },
}

let webport = nconf.get('web:port') || 7070
const listenCfg = nconf.get('web:listen');
const base_host = (listenCfg === '0.0.0.0' ? false : listenCfg) || '127.0.0.1'
const base_url = 'http://' + base_host + ':' + webport + '/'

const platform_admin_url = 'http://' + (nconf.get('admin:listen') || '127.0.0.1') + ':' + (nconf.get('admin:port') || 3000)
console.log('platform url', base_url)
console.log('admin    url', platform_admin_url)

let token = ''

const adnServerAPI = require('../loki/server/fetchWrapper.js')
const platformApi = new adnServerAPI(base_url)
// do we need this?
const adminApi    = new adnServerAPI(platform_admin_url, nconf.get('admin:modKey'))

// FIXME: username should be configurable
function findOrCreateUser(username) {
  if (!username) return false
  return new Promise((resolve, rej) => {

    // does our test user exist?
    cache.getUserID(username, function(err, user) {
      if (err) {
        console.error('findOrCreateUser::getUserID err', err)
        return rej(err)
      }
      // why did it shift form null to undefined?
      //console.log('findOrCreateUser::getUserID result', user)
      if (user !== null && user !== undefined) {
        //console.log('found user', user)
        return resolve(user.id)
      }
      // create test user
      console.log('creating test user', username)
      cache.addUser(username, '', function(err, user) {
        if (err) {
          console.error('findOrCreateUser::addUser err', err)
          return rej(err)
        }
        //console.log('created user', user.id, user.toString())
        resolve(user.id)
      })
    })
  })
}

function findOrCreateToken(userid) {
  if (!userid) return false
  return new Promise((resolve, rej) => {
    cache.createOrFindUserToken(userid, 'mocha_platform_test', ADN_SCOPES, function(err, usertoken) {
      if (err) {
        console.error('findOrCreateToken::addAPIUserToken', err)
        return rej(err)
      }
      if (!usertoken || usertoken === null) {
        return rej('no usertoken')
      }
      resolve(usertoken.token)
    })
  })
}

const ensureServer = () => {
  return new Promise((resolve, rej) => {
    const platformURL = new URL(base_url)
    console.log('platform port', platformURL.port)
    lokinet.portIsFree(platformURL.hostname, platformURL.port, function(free) {
      if (free) {
        // ini overrides server/config.json in unit testing (if platform isn't running where it should)
        // override any config to make sure it runs the way we request
        process.env.web__port = platformURL.port
        process.env.admin__port = nconf.get('admin:port') || 3000
        process.env.admin__modKey = nconf.get('admin:modKey') || '123abc'
        const startPlatform = require('../app')
        function portNowClaimed() {
          lokinet.portIsFree(platformURL.hostname, platformURL.port, function(free) {
            if (!free) {
              console.log(platformURL.port, 'now claimed')
              resolve()
            } else {
              setTimeout(portNowClaimed, 100)
            }
          })
        }
        portNowClaimed()
      } else {
        console.log('detected running server')
        resolve()
      }
    })
  })
}

const testConfig = {
  platformApi,
  testUsername: 'test',
  //testUserid set in setupTesting()
}

//const nodeFetch = require('node-fetch')

async function setupTesting() {

  describe('ensureServer', async () => {
    it('make sure we have something to test', async () => {
      await ensureServer()
      //console.log('platform ready')
    })
    // need the following in an `it` to make sure it only happens after the server is set up

    it('setting up token to use with testing', async () => {
      testConfig.testUserid = await findOrCreateUser('test')
      if (testConfig.testUserid === undefined) {
        console.error('Couldnt create/find user to test with')
        process.exit(1)
      }
      // console.log('testUserId', testConfig.testUserid)
      token = await findOrCreateToken(testConfig.testUserid)
      // assert we have a token...
      console.log('got token', token, 'for user @test')
      platformApi.token = token
      // we could knock on a loki/v1 URL for loki specific stuff
      // like mod/dewhitelisting...
      // but then I worry about security implications of such a knock
      // console.log('baseUrl', platformApi.base_url)
      // only on file-server rn
      //const res = await platformApi.serverRequest('loki/v1/config')
      const res = await platformApi.serverRequest('loki/v1/user_info')
      console.log('loki test', res.statusCode)
      if (res.statusCode === 403) {
        // we're in whitelist mode...

        // get mod token
        // use it...
        // can't get_moderations because we don't have a valid token
        /*
        const modRes = await platformApi.serverRequest(`loki/v1/channel/1/get_moderators`)
        if (!modRes.response.moderators) {
          console.warn('cant read moderators for channel 1', res)
          return
        }
        const modKeys = modRes.response.moderators
        console.log('modKeys', modKeys)
        */

        // so lets assume tokens for userid are whitelisted...
        await new Promise(resolve => {
          cache.getUser(1, function(err, user) {
            if (err) console.error('getUser for user 1 err', err)
            if (!user) {
              console.log('No user 1')
              process.exit(1)
            }
            // override test users with default
            testConfig.testUsername = user.username
            testConfig.testUserid = user.id
            // console.log('testUserId', testConfig.testUserid)
            cache.getAPITokenByUsername(user.username, async function(err, usertoken, meta) {
              if (err) consoel.error('getAPIUserToken for user 1 err', err)
              if (!usertoken) {
                console.log('No token for user 1')
                process.exit(1)
              }
              // console.log('token', usertoken.token)
              var modToken = usertoken.token
              var oldToken = platformApi.token
              platformApi.token = usertoken.token
              // whitelist @test
              const result = await platformApi.serverRequest('loki/v1/moderation/whitelist/@test', {
                method: 'POST',
              })
              console.log('whitelist result', result)
              // no we need to run tests as user 1
              //platformApi.token = oldToken
              resolve()
            })
          })
        })
      } else if (res.statusCode === 404) {
        // normal, non-loki
      } else if (res.statusCode === 200) {
        // loki but either already whitelisted or not in whitelist mode?
      } else {
        console.log('statusCode', res.statusCode)
      }
      console.log('using @' + testConfig.testUsername + '(' + testConfig.testUserid + ')')
    })
  })

}

setupTesting()

// for rdev
// web__port=7082 admin__modKey=CHANGEME pomf__provider_url=http://localhost:7082/upload admin__port=3005

// we're group these in order of documentation groups
// but I wonder if we should re-org by our internal module process
// like get user files (/users/me/files) doesn't belong in users...

function runIntegrationTests() {
  // FIXME set a base_dir

  // make sure we're reading the file server config file...
  assert.ok(!configUtil.moduleEnabled('channels'))

  describe('#token', async () => {
    require('../loki/server/test/test.tokens').runTests(platformApi)
  })

    describe('#users', async () => {
      require('../loki/server/test/test.users').runTests(platformApi, { skipUserSearch: true })
    })
      if (configUtil.moduleEnabled('files')) {
        describe('#files', async () => {
          require('../loki/server/test/test.files').runTests(platformApi, nconf)
        })
      }
      describe('#mutes', async () => {
        require('../loki/server/test/test.mutes').runTests(platformApi)
      })
      if (configUtil.moduleEnabled('posts')) {
        describe('#posts', async () => {
          require('../loki/server/test/test.posts').runTests(platformApi)
        })
          describe('#interactions', async () => {
            require('../loki/server/test/test.interactions').runTests(platformApi)
          })
      }
        if (configUtil.moduleEnabled('markers')) {
          describe('#markers', async () => {
            require('../loki/server/test/test.markers').runTests(platformApi)
          })
        }
      if (configUtil.moduleEnabled('channels')) {
        describe('#channels', async () => {
          require('../loki/server/test/test.channels').runTests(platformApi, testConfig)
        })
      }
}

runIntegrationTests()
