
FROM node:latest

WORKDIR /opt/app
COPY . /opt/app

RUN npm install -g pm2
RUN npm i

CMD [ "pm2-docker", "start", "/opt/app/pm2.json" ]