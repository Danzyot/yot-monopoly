# Same flow as local: npm ci → build client → npm start.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w client

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
