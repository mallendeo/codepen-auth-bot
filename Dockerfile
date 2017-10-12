
FROM node:latest

WORKDIR /opt/app
COPY . /opt/app

RUN mkdir -p /opt/app/logs

RUN yarn global add pm2
RUN yarn

CMD [ "pm2-docker", "start", "/opt/app/pm2.json" ]