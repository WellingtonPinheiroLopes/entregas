FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app.js server.js ./
COPY src ./src
RUN chmod -R a+rX app.js server.js src

USER node

EXPOSE 3000

CMD ["node", "server.js"]
