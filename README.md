# codepen-auth-bot

## Install
```bash
$ git clone https://github.com/mallendeo/codepen-auth-bot
$ cd codepen-auth-bot
$ yarn # npm i
$ mkdir logs

# Define environment variables
$ export NODE_ENV="development"
$ export CDP_USER="someuser"
$ export PEN_ID="PenID"
$ export JWT_SECRET="some random large string",
$ export CDP_SESSION_COOKIE="codepen_session=SOME_SESSION_ID; path=/; expires=Mon, 24 Jul 2017 06:43:07 -0000; secure; HttpOnly"

$ npm start
```

# Docker

Copy pm2 ecosystem file and edit environment variables accordingly.

```bash
$ cp pm2.example.json pm2.json
```

## Build

```bash
$ docker build -t codepen-auth-bot .
```

## Run

```bash
$ docker run --name codepen-auth -p 3000:3000 \
  -v $HOME/.codepen-auth/logs:/opt/app/logs \
  --restart=always -d codepen-auth-bot
```

# License

MIT
