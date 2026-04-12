export class Logger {
  private timestamp(): string {
    return new Date().toISOString().replace("T", " ").slice(0, -1);
  }

  info(message: string): void {
    console.log(`[${this.timestamp()}] [INFO] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[${this.timestamp()}] [WARN] ${message}`);
  }

  error(message: string, error?: unknown): void {
    console.error(`[${this.timestamp()}] [ERROR] ${message}`);

    if (error !== undefined) {
      console.error(error);
    }
  }
}
