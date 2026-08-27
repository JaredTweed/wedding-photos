FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY shared.js ./shared.js
COPY worker/index.js ./worker/index.js

USER node
CMD ["node", "worker/index.js"]
