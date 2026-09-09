# Mirrors the tested local flow exactly: npm ci → build client → npm start.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund \
    # The audit page needs country lookups, not city ones: dropping the city
    # tables takes geoip-lite from ~154 MB to ~14 MB with no loss of function.
    && rm -f node_modules/geoip-lite/data/geoip-city*.dat

COPY . .
RUN npm run build -w client

ENV NODE_ENV=production
EXPOSE 8080
# Persist /app/server/data with a volume to keep leaderboard history + auth secret.
CMD ["npm", "start"]
