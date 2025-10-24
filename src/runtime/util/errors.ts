/**
 * Custom error types for the workflow runtime
 */

export class WorkflowError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WorkflowError';
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

export class NodeExecutionError extends WorkflowError {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly nodeKind: string,
    public readonly cause?: Error
  ) {
    super(message, 'NODE_EXECUTION_ERROR');
    this.name = 'NodeExecutionError';
    Object.setPrototypeOf(this, NodeExecutionError.prototype);
  }
}

export class NodeTimeoutError extends WorkflowError {
  constructor(
    public readonly nodeId: string,
    public readonly nodeKind: string,
    public readonly timeoutMs: number
  ) {
    super(
      `Node ${nodeId} timed out after ${timeoutMs}ms`,
      'NODE_TIMEOUT'
    );
    this.name = 'NodeTimeoutError';
    Object.setPrototypeOf(this, NodeTimeoutError.prototype);
  }
}

export class AgentError extends WorkflowError {
  constructor(
    message: string,
    public readonly agentName: string,
    public readonly cause?: Error
  ) {
    super(message, 'AGENT_ERROR');
    this.name = 'AgentError';
    Object.setPrototypeOf(this, AgentError.prototype);
  }
}

export class CacheError extends WorkflowError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, 'CACHE_ERROR');
    this.name = 'CacheError';
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}

export class ValidationError extends WorkflowError {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class DeadlockError extends WorkflowError {
  constructor(
    message: string,
    public readonly pendingNodes: string[]
  ) {
    super(message, 'DEADLOCK_ERROR');
    this.name = 'DeadlockError';
    Object.setPrototypeOf(this, DeadlockError.prototype);
  }
}

export class DependencyError extends WorkflowError {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly missingDeps: string[]
  ) {
    super(message, 'DEPENDENCY_ERROR');
    this.name = 'DependencyError';
    Object.setPrototypeOf(this, DependencyError.prototype);
  }
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof NodeExecutionError) {
    let msg = `[${error.nodeId}] ${error.message}`;
    if (error.cause) {
      msg += `\nCause: ${error.cause.message}`;
    }
    return msg;
  }
  
  if (error instanceof WorkflowError) {
    return `[${error.code}] ${error.message}`;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return String(error);
}

/**
 * Extract error details for logging
 */
export function extractErrorDetails(error: unknown): {
  message: string;
  code?: string;
  stack?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof NodeExecutionError) {
    return {
      message: error.message,
      code: error.code,
      stack: error.stack,
      details: {
        nodeId: error.nodeId,
        nodeKind: error.nodeKind,
        cause: error.cause?.message,
      },
    };
  }
  
  if (error instanceof WorkflowError) {
    return {
      message: error.message,
      code: error.code,
      stack: error.stack,
    };
  }
  
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  
  return {
    message: String(error),
  };
}

