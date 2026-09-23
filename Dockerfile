# Same flow as local: npm ci → build client → npm start.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund \
    # Country lookups only: drop geoip-lite's city tables (~140 MB).
    && rm -f node_modules/geoip-lite/data/geoip-city*.dat

COPY . .
RUN npm run build -w client

ENV NODE_ENV=production
EXPOSE 8080
# Mount a volume at /data and set DATA_DIR=/data to keep bans, results and live games.
CMD ["npm", "start"]
