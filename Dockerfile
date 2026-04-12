FROM oven/bun:1-alpine

WORKDIR /app
COPY . .

RUN bun i --production

EXPOSE 8080
CMD ["bun", "run", "src/server.ts", "-p", "8080", "--expose"]
