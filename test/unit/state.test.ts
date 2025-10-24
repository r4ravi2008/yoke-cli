import { describe, it, expect } from '@jest/globals';
import { RunStateAnnotation, createInitialState, NodeStatus } from '../../src/runtime/graph/state';

describe('RunState', () => {
  describe('RunStateAnnotation', () => {
    it('should define all required fields', () => {
      const annotation = RunStateAnnotation.spec;
      expect(annotation.vars).toBeDefined();
      expect(annotation.outputs).toBeDefined();
      expect(annotation.statuses).toBeDefined();
      expect(annotation.next).toBeDefined();
      expect(annotation.failed).toBeDefined();
    });
  });

  describe('createInitialState', () => {
    it('should create state with empty vars', () => {
      const state = createInitialState();
      
      expect(state.vars).toEqual({});
      expect(state.outputs).toEqual({});
      expect(state.statuses).toEqual({});
      expect(state.next).toEqual([]);
      expect(state.failed).toBeNull();
    });

    it('should create state with provided vars', () => {
      const vars = { foo: 'bar', count: 42 };
      const state = createInitialState(vars);
      
      expect(state.vars).toEqual(vars);
      expect(state.outputs).toEqual({});
      expect(state.statuses).toEqual({});
      expect(state.next).toEqual([]);
      expect(state.failed).toBeNull();
    });

    it('should not mutate input vars', () => {
      const vars = { foo: 'bar' };
      const state = createInitialState(vars);
      
      state.vars.foo = 'baz';
      expect(vars.foo).toBe('bar');
    });
  });

  describe('NodeStatus', () => {
    it('should have all expected status values', () => {
      const statuses: NodeStatus[] = [
        'PENDING',
        'RUNNING',
        'CACHED',
        'SUCCESS',
        'FAILED',
        'SKIPPED',
      ];
      
      // This test just ensures the types compile correctly
      expect(statuses.length).toBe(6);
    });
  });

  describe('State structure', () => {
    it('should have correct annotation spec structure', () => {
      const spec = RunStateAnnotation.spec;

      expect(spec.vars).toBeDefined();
      expect(spec.outputs).toBeDefined();
      expect(spec.statuses).toBeDefined();
      expect(spec.next).toBeDefined();
      expect(spec.failed).toBeDefined();
    });

    it('should create state with correct types', () => {
      const state = createInitialState({ test: 'value' });

      expect(typeof state.vars).toBe('object');
      expect(typeof state.outputs).toBe('object');
      expect(typeof state.statuses).toBe('object');
      expect(Array.isArray(state.next)).toBe(true);
      expect(state.failed).toBeNull();
    });
  });
});

