import * as Handlebars from 'handlebars';
import { promises as fs } from 'fs';
import * as path from 'path';

export function createTemplateEngine(context: {
  vars: Record<string, unknown>;
  outputs: Record<string, unknown>;
  item?: unknown;
}) {
  const handlebars = Handlebars.create();

  handlebars.registerHelper('basename', (filepath: string) => {
    return path.basename(filepath);
  });

  handlebars.registerHelper('dirname', (filepath: string) => {
    return path.dirname(filepath);
  });

  handlebars.registerHelper('join', (arr: unknown[], separator: string = ',') => {
    if (!Array.isArray(arr)) return '';
    return arr.join(separator);
  });

  handlebars.registerHelper('json', (obj: unknown) => {
    return JSON.stringify(obj);
  });

  handlebars.registerHelper('loads_file', (filepath: string) => {
    const fullPath = path.resolve(filepath);
    try {
      const content = require('fs').readFileSync(fullPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load file ${filepath}: ${error}`);
    }
  });

  return {
    render: (template: string): string => {
      const compiled = handlebars.compile(template);
      return compiled(context);
    },
    renderObject: <T>(obj: T): T => {
      return renderObjectRecursive(obj, context, handlebars);
    },
  };
}

function renderObjectRecursive<T>(
  obj: T,
  context: Record<string, unknown>,
  handlebars: typeof Handlebars
): T {
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
      const expression = trimmed.slice(2, -2).trim();
      const value = resolveExpression(expression, context);
      if (value !== undefined) {
        return value as T;
      }
    }
    const compiled = handlebars.compile(obj);
    return compiled(context) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => renderObjectRecursive(item, context, handlebars)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = renderObjectRecursive(value, context, handlebars);
    }
    return result;
  }

  return obj;
}

function resolveExpression(expression: string, context: Record<string, unknown>): unknown {
  const parts = expression.split('.');
  let current: any = context;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}
