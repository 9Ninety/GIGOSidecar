export class Logger {
  timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, -1);
  }

  info(msg) {
    console.log(`[${this.timestamp()}] [INFO] ${msg}`);
  }

  warn(msg) {
    console.warn(`[${this.timestamp()}] [WARN] ${msg}`);
  }

  error(msg, err) {
    console.error(`[${this.timestamp()}] [ERROR] ${msg}`);
    if (err != null) {
      console.error(err);
    }
  }
}
