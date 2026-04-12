FROM node:20-slim

WORKDIR /app
COPY . .
EXPOSE 8080


CMD ["node", "src/server.mjs", "-p", "8080", "--expose"]
