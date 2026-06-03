import { describe, it, expect } from 'vitest';
import { substituteEnv, substituteUrl } from './substituteVariables.js';

// Regression tests for GH-59:
// Variables set in a pre-request script (pm.variables.set / pm.environment.set)
// must be resolvable in headers/URL/body even when NO environment is active.
// The execution hooks accumulate those script updates into a `scriptVariables`
// map and pass it to substitution; substitution must honor it with the highest
// precedence (script > environment > collection).

describe('substituteEnv — scriptVariables (GH-59)', () => {
  it('resolves a script-set variable in a header value with no environment', () => {
    // Bug: header was sent with the literal `{{token}}` instead of `abc123`.
    const result = substituteEnv('Bearer {{token}}', {
      scriptVariables: { token: 'abc123' },
    });
    expect(result).toBe('Bearer abc123');
  });

  it('resolves script variables with optional inner whitespace', () => {
    const result = substituteEnv('Bearer {{ token }}', {
      scriptVariables: { token: 'abc123' },
    });
    expect(result).toBe('Bearer abc123');
  });

  it('resolves script variables in a request body with no environment', () => {
    const result = substituteEnv('{"auth":"{{token}}"}', {
      scriptVariables: { token: 'abc123' },
    });
    expect(result).toBe('{"auth":"abc123"}');
  });

  it('script variables override environment variables (precedence)', () => {
    const result = substituteEnv('{{token}}', {
      environment: {
        variables: [{ key: 'token', current_value: 'env-value', enabled: true }],
      },
      scriptVariables: { token: 'script-value' },
    });
    expect(result).toBe('script-value');
  });

  it('script variables override collection variables (precedence)', () => {
    const result = substituteEnv('{{token}}', {
      collectionVariables: [{ key: 'token', value: 'collection-value', enabled: true }],
      scriptVariables: { token: 'script-value' },
    });
    expect(result).toBe('script-value');
  });

  it('falls back to environment when no script variable is set for the key', () => {
    const result = substituteEnv('{{base}}/{{token}}', {
      environment: {
        variables: [{ key: 'base', current_value: 'https://api.test', enabled: true }],
      },
      scriptVariables: { token: 'abc123' },
    });
    expect(result).toBe('https://api.test/abc123');
  });

  it('leaves behavior unchanged when scriptVariables is omitted', () => {
    const result = substituteEnv('Bearer {{token}}', {
      environment: {
        variables: [{ key: 'token', current_value: 'env-value', enabled: true }],
      },
    });
    expect(result).toBe('Bearer env-value');
  });
});

describe('substituteUrl — scriptVariables (GH-59)', () => {
  it('resolves a script-set variable in the URL with no environment', () => {
    const result = substituteUrl('https://api.test/{{path}}', {
      scriptVariables: { path: 'users' },
    });
    expect(result).toBe('https://api.test/users');
  });

  it('resolves a script-set variable used as a path-variable value', () => {
    const result = substituteUrl('https://api.test/:id', {
      pathVariables: [{ key: 'id', value: '{{userId}}' }],
      scriptVariables: { userId: '42' },
    });
    expect(result).toBe('https://api.test/42');
  });

  it('script variables override environment variables in the URL', () => {
    const result = substituteUrl('https://api.test/{{path}}', {
      environment: {
        variables: [{ key: 'path', current_value: 'env-path', enabled: true }],
      },
      scriptVariables: { path: 'script-path' },
    });
    expect(result).toBe('https://api.test/script-path');
  });
});
