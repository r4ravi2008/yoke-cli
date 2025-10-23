import Ajv from 'ajv';

const workflowSchema = {
  type: 'object',
  properties: {
    version: { type: 'number' },
    name: { type: 'string' },
    concurrency: { type: 'number' },
    vars: { type: 'object' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['exec', 'task', 'map', 'reduce'] },
          name: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
          deterministic: { type: 'boolean' },
          timeout: { type: 'number' },
          retries: { type: 'number' },
          command: { type: 'string' },
          args: { type: 'array' },
          cwd: { type: 'string' },
          env: { type: 'object' },
          produces: { type: 'object' },
          agent: { type: 'string' },
          prompt: { type: 'string' },
          inputs: { type: 'object' },
          artifacts: { type: 'array' },
          over: {},
          map: { type: 'object' },
          reduce: { type: 'object' },
        },
        additionalProperties: true,
      },
    },
  },
  required: ['version', 'name', 'nodes'],
  additionalProperties: false,
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(workflowSchema);

export function validateWorkflow(workflow: unknown): { valid: boolean; errors?: string[] } {
  const valid = validate(workflow);
  if (!valid && validate.errors) {
    return {
      valid: false,
      errors: validate.errors.map((err) => `${err.instancePath} ${err.message}`),
    };
  }
  return { valid: true };
}
