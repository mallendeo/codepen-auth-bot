'use strict'

const axios = require('axios')
const cheerio = require('cheerio')
const querystring = require('querystring')

module.exports = (sessionCookie, username, pen) => {
  const referer = `https://codepen.io/${username}/pen/${pen}`

  const state = {
    codepenSession: [sessionCookie],
    csrfToken: null,
    cookies: null
  }

  // TODO: now is useless because recaptcha
  const login = async () => {
    const loginUrl = 'https://codepen.io/login'
    const res = await axios(loginUrl)
    const authToken = res.data.match(/name="authenticity_token"\s+value="(.{1,})"/)[1]

    const resLogin = await axios({
      method: 'post',
      url: `${loginUrl}/login`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: res.headers['set-cookie'],
        referer: loginUrl
      },
      data: querystring.stringify({
        utf8: '✓',
        authenticity_token: authToken,
        email: username,
        password: password,
        'login-type': 'fullpage'
      })
    })

    if (resLogin.data.success) {
      state.codepenSession = resLogin.headers['set-cookie']

      return resLogin.data
    }
  }

  const updateToken = async () => {
    const res = await axios(referer, {
      headers: {
        cookie: state.codepenSession
      }
    })

    const token = res.data.match(/csrf-token"\s+content="(.{1,})"/)[1]
    const cookies = res.headers['set-cookie']

    state.csrfToken = token
    state.cookies = cookies

    return { token, cookies }
  }

  const getAllComments = async () => {
    const res = await axios(`https://codepen.io/${username}/details/${pen}`, {
      headers: {
        cookie: state.codepenSession
      }
    })

    const $ = cheerio.load(res.data)

    return $('.group.comment')
      .map((index, elem) => {
        const text = $(elem).find('.comment-text').text().trim()
        const id = $(elem).attr('id').match(/comment-id-(.{1,})/)[1]
        const username = $(elem).find('span.username').text().substring(1)
        const name = $(elem).find('.comment-username').text().trim()
        const avatar = $(elem).find('.comment-avatar').attr('src')

        const match = avatar.match(/cdpn\.io\/(\d{1,})/)
        const userId = match && match[1]

        return { text, id, name, username, userId: userId && Number(userId) }
      })
      .get()
  }

  const deleteComment = async commentId => {
    if (!commentId) throw Error('commentId required!')
    const url = `https://codepen.io/comment/delete/pen/${commentId}`

    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': state.csrfToken,
      referer,
      cookie: state.cookies
    }

    const res = await axios({ url, method: 'POST', headers })
    if (!res.data.success) throw Error(`Couldn't delete the comment.`)

    return res.data
  }

  return {
    updateToken,
    getAllComments,
    deleteComment,
    login
  }
}
