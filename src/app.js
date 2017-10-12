'use strict'

const {
  CDP_USER,
  CDP_SESSION_COOKIE,
  PEN_ID,
  JWT_SECRET,
  NODE_ENV,
  PORT = 3000
} = process.env

if (!JWT_SECRET) throw Error('JWT_SECRET required!')

if (!CDP_USER || !CDP_SESSION_COOKIE || !PEN_ID) {
  throw Error('CDP_USER, CDP_SESSION_COOKIE and PEN_ID required!')
}

const socketio = require('socket.io')
const http = require('http')
const express = require('express')

const fs = require('fs')
const jwt = require('jsonwebtoken')
const { uniqBy } = require('lodash')

const initBot = require('./lib/bot')

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
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'all.log' })
  ]
})

if (NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.simple()
  }))
}

// --------------
// Init
// --------------

const app = express()
const server = http.Server(app)
const io = socketio(server)

server.listen(PORT, () => {
  logger.info('Bot started!')
  logger.info(`Listening on port ${PORT}`)
})

app.get('/', (req, res) => {
  res.json({ success: true })
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
    if (state.hasNextReq && now - state.lastRequest > 2000) {
      
      logger.info(`Auth request detected!`)
      state.lastRequest && logger.info(`Time since last request: ${now - state.lastRequest}ms`)
  
      state.hasNextReq = false
      state.lastRequest = Date.now()
      const comments = await bot.getAllComments()
      
      logger.info(`Parsed comments: ${JSON.stringify(comments, null, 2)}`)
      
      const tokens = comments.map(comment => {
        
        const { username, userId, name } = comment
        const token = jwt.sign(
          { username, userId, name },
          JWT_SECRET,
          { expiresIn: '24h' }
        )
        
        bot.deleteComment(comment.id)
          .then(removed => {
            logger.info(`Comment removed: ${comment.id}, ${comment.username}, ${comment.text}`)
          })
          .catch(e => {
            logger.error(`Error when removing comment: ${comment.id}`)
          })

        return {
          token,
          to: comment.text,
          userId,
          username,
          name
        }
      })

      // Send the tokens only to the first comment with
      // the same session id
      uniqBy(tokens, 'to').forEach(token => {
        io.to(token.to).emit('authenticated', token)
      })
    }
  }, 1000)

  io.on('connection', client => {
    logger.info(`Client connected: ${client.id}`)

    client.on('notify', async () => {
      logger.info(`Notified by: ${client.id}`)
      state.hasNextReq = true
    })

    client.on('verify', async (token) => {
      try {
        const valid = jwt.verify(token, JWT_SECRET)
        logger.log('debug', `TOKEN_VALID ${valid.username}`);
        client.emit('tokenValid', valid)
      } catch (err) {
        logger.log('debug', `TOKEN_ERROR ${err}`);
        client.emit('tokenError', err)
      }
    })
  })

  // renew tokens and cookies each 10 minutes
  setInterval(async () => {
    logger.info(`Updating token...`)
    await bot.updateToken()
  }, 600000)
})()
