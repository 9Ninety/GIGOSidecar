FROM node:24-slim

WORKDIR /app
COPY . .
EXPOSE 8080


CMD ["node", "--experimental-strip-types", "src/server.ts", "-p", "8080", "--expose"]
