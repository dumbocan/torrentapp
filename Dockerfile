FROM node:20-slim

# Install CA certificates to fix SSL errors
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p downloads

EXPOSE 3000

CMD ["node", "server.js"]
