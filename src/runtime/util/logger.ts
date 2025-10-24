/**
 * Structured logging utility for the workflow runtime
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  nodeId?: string;
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface LoggerOptions {
  level?: LogLevel;
  verbose?: boolean;
  onLog?: (entry: LogEntry) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private verbose: boolean;
  private onLog?: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info';
    this.verbose = options.verbose || false;
    this.onLog = options.onLog;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    // Call custom log handler if provided
    if (this.onLog) {
      this.onLog(entry);
    }

    // Console output if verbose
    if (this.verbose) {
      const prefix = entry.nodeId ? `[${entry.nodeId}]` : '';
      const levelStr = entry.level.toUpperCase().padEnd(5);
      const timestamp = new Date(entry.timestamp).toISOString();
      
      let message = `${timestamp} ${levelStr} ${prefix} ${entry.message}`;
      
      if (entry.context && Object.keys(entry.context).length > 0) {
        message += `\n  Context: ${JSON.stringify(entry.context, null, 2)}`;
      }
      
      if (entry.error) {
        message += `\n  Error: ${entry.error.message}`;
        if (entry.error.stack && this.level === 'debug') {
          message += `\n  Stack: ${entry.error.stack}`;
        }
      }

      switch (entry.level) {
        case 'error':
          console.error(message);
          break;
        case 'warn':
          console.warn(message);
          break;
        default:
          console.log(message);
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>, nodeId?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      context,
      nodeId,
    });
  }

  info(message: string, context?: Record<string, unknown>, nodeId?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      context,
      nodeId,
    });
  }

  warn(message: string, context?: Record<string, unknown>, nodeId?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      context,
      nodeId,
    });
  }

  error(message: string, error?: Error | unknown, nodeId?: string): void {
    const errorDetails = error instanceof Error
      ? {
          message: error.message,
          stack: error.stack,
          code: (error as any).code,
        }
      : error
      ? { message: String(error) }
      : undefined;

    this.log({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      error: errorDetails,
      nodeId,
    });
  }

  /**
   * Create a child logger with a specific node context
   */
  forNode(nodeId: string): NodeLogger {
    return new NodeLogger(this, nodeId);
  }
}

/**
 * Node-scoped logger that automatically includes node ID
 */
export class NodeLogger {
  constructor(
    private parent: Logger,
    private nodeId: string
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, context, this.nodeId);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, context, this.nodeId);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, context, this.nodeId);
  }

  error(message: string, error?: Error | unknown): void {
    this.parent.error(message, error, this.nodeId);
  }
}

/**
 * Create a default logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

