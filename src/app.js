'use strict'

const {
  CDP_USER,
  CDP_SESSION_COOKIE,
  PEN_ID,
  NODE_ENV,
  PORT = 3000
} = process.env

if (!CDP_USER || !CDP_SESSION_COOKIE || !PEN_ID) {
  throw Error('CDP_USER, CDP_SESSION_COOKIE and PEN_ID required!')
}

const socketio = require('socket.io')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { uniqBy } = require('lodash')

const initBot = require('./lib/bot')

//------------------------------------------
//                 Logging
//------------------------------------------
const { createLogger, format, transports } = require('winston')
const { combine, timestamp, label, printf } = format

const loggerFormat = printf(info => {
  return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`
})

const logger = createLogger({
  level: 'info',
  format: combine(
    label({ label: 'cdp-bot' }),
    timestamp(),
    loggerFormat
  ),
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/all.log' })
  ]
})

if (NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.simple()
  }))
}

//------------------------------------------
//                Database
//------------------------------------------
const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: 'data/db.sqlite'
  }
})

knex.schema
  .createTableIfNotExists('apps', table => {
    table.increments('id').primary()
    table.string('apiKey').index().unique()
    table.string('apiSecret').index().unique()
    table.string('ip').index()
    table.timestamp('created_at').defaultTo(knex.fn.now())
  })
  .catch(e => logger.error(e.message))

//------------------------------------------
//               Init Server
//------------------------------------------

const app = express()
const server = http.Server(app)
const io = socketio(server)
const ns = io.of('/auth')

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  res.header('Access-Control-Allow-Credentials', 'true')
  
  next()
})

// JSON and URL-encoded support
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Start server
server.listen(PORT, () => {
  logger.info('Bot started!')
  logger.info(`Listening on port ${PORT}`)
})

const state = {
  lastRequest: null,
  hasNextReq: false
}

;(async () => {
  const bot = initBot(CDP_SESSION_COOKIE, CDP_USER, PEN_ID)
  await bot.updateToken()

  setInterval(async () => {
    const now = Date.now()
    const diff = now - state.lastRequest

    if (state.hasNextReq && diff > 2000) {
      
      logger.info(`Auth request detected!`)
      state.lastRequest && logger.info(`Time since last request: ${diff}ms`)
  
      state.hasNextReq = false
      state.lastRequest = Date.now()
      const comments = await bot.getAllComments()
      
      logger.info(`Parsed comments: ${JSON.stringify(comments, null, 2)}`)
      
      /**
       * token Array<Promise>
       */
      const tokens = comments.map(async comment => {
        
        const { username, userId, name, text } = comment

        const [ socketID, apiKey ] = text.split(':')

        bot.deleteComment(comment.id)
          .then(removed => {
            logger.info(`Comment removed: ${comment.id}, ${username}, ${text}`)
          })
          .catch(e => {
            logger.error(`Error when removing comment: ${comment.id}`)
          })

        if (!socketID || !apiKey) {
          logger.error(`Wrong comment format: ${comment.text}`)
          return
        }
        
        const result = await knex
          .select('apiSecret')
          .from('apps')
          .where('apiKey', '=', apiKey)
          .first()

        if (!result) {
          logger.error(`Couldn't find apiKey ${apiKey}`)
          return
        }
        if (result && result.apiSecret.length !== 64) {
          logger.error(`Wrong apiSecret length: ${apiSecret.length}`)
          return
        }

        const token = jwt.sign(
          { username, userId, name },
          result.apiSecret,
          { expiresIn: 60 * 5 }
        )

        return {
          token,
          to: socketID,
          userId,
          username,
          name
        }
      })

      // Send the tokens only to the first comment with
      // the same session id
      uniqBy(tokens, 'to')
        .filter(t => t)
        .forEach(async tokenPromise => {
          const token = await tokenPromise
          ns.to(`/auth#${token.to}`).emit('authenticated', token)
        })
    }
  }, 1000)

  ns.on('connection', client => {
    logger.info(`Client connected: ${client.id}`)

    client.on('notify', async () => {
      logger.info(`Notified by: ${client.id}`)
      state.hasNextReq = true
    })
  })

  // REST endpoints
  app.get('/', (req, res) => {
    res.json({
      success: true,
      name: 'CodePen Auth',
      description: 'Allow CodePen users to authenticate with your app.'
    })
  })

  app.post('/verify', (req, res, next) => {
    const { token, apiSecret } = req.body
    
    if (!token || !apiSecret) {
      res.status(400).json({
        error: `'token' and 'apiSecret' parameters required!`
      })

      return
    }

    try {
      const validToken = jwt.verify(token, apiSecret)
      logger.log('debug', `TOKEN_VALID ${validToken.username}`);
      res.json({ valid: true, data: validToken })
    } catch (e) {
      logger.log('debug', `TOKEN_ERROR ${e}`);
      res.json({ valid: false, error: e.message })
    }
  })

  const randomHex = (len = 32) => new Promise((resolve, reject) => {
    crypto.randomBytes(len, async (err, buffer) => {
      if (err) {
        reject(err)
        return
      }
      resolve(buffer.toString('hex'))
    })
  })

  app.get('/createApp', async (req, res, next) => {
    try {
      const apiKey = await randomHex(16)
      const apiSecret = await randomHex()
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
      const result = await knex('apps').insert({ apiKey, apiSecret, ip })

      if (result.length && result[0]) {
        res.json({ apiKey, apiSecret })
      }
    } catch (e) {
      res.status(500).json({ error: true })
    }
  })

  // renew tokens and cookies each 10 minutes
  setInterval(async () => {
    logger.info(`Updating token...`)
    await bot.updateToken()
  }, 600000)
})()
