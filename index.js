'use strict'

const { CDP_USER, CDP_SESSION_COOKIE, PEN_ID, JWT_SECRET } = process.env

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

const app = express()
const server = http.Server(app)
const io = socketio(server)

server.listen(process.env.PORT || 3001)

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
      state.hasNextReq = false
      state.lastRequest = Date.now()
      const comments = await bot.getAllComments()

      const tokens = comments.map(comment => {

        const { username, userId, name } = comment
        const token = jwt.sign(
          { username, userId, name },
          JWT_SECRET,
          { expiresIn: '24h' }
        )

        bot.deleteComment(comment.id).then(removed => {
          console.log('comment removed', { removed, comment })
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
    console.log('connected!', client.id)

    client.on('notify', async () => {
      console.log('notified by', client.id)
      state.hasNextReq = true
    })

    client.on('verify', async (token) => {
      try {
        const valid = jwt.verify(token, JWT_SECRET)
        console.log('TOKEN_VALID', valid.username)
        client.emit('tokenValid', valid)
      } catch (err) {
        client.emit('tokenError', err)
        console.log('TOKEN_ERROR', err)
      }
    })
  })

  // renew tokens and cookies each 10 minutes
  setInterval(async () => {
    await bot.updateToken()
  }, 600000)
})()
