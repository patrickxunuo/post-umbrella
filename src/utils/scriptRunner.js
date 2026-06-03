/**
 * Script Runner Utility
 * Executes pre-script and post-script with a Postman-like pm object
 */

function tryParseJson(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed); } catch { return val; }
  }
  return val;
}

/**
 * Create a pm object for script execution
 * @param {Object} context - The context for script execution
 * @param {Object} context.environment - Active environment object
 * @param {Function} context.onEnvironmentUpdate - Callback to update environment
 * @param {Object} context.request - Request data (for pre-script)
 * @param {Object} context.response - Response data (for post-script)
 * @param {Function} context.onRequestUpdate - Callback to update request (pre-script)
 * @returns {Object} pm object
 */
function createPmObject(context) {
  const {
    environment,
    onEnvironmentUpdate,
    collectionVariables,
    localVariables,
    request,
    response,
    onRequestUpdate,
  } = context;

  // Store for variables set during script execution
  const envUpdates = {};
  const collectionVarUpdates = {};
  // Transient local scope (pm.variables) — seeded with vars set by earlier
  // scripts in the same request execution, accumulated as this script runs.
  const localUpdates = { ...(localVariables || {}) };

  const pm = {
    // Environment operations
    environment: {
      get: (key) => {
        // Check updates first, then existing environment
        if (key in envUpdates) {
          return tryParseJson(envUpdates[key]);
        }
        if (!environment?.variables) return undefined;
        const variable = environment.variables.find(v => v.key === key && v.enabled);
        const val = variable?.current_value ?? variable?.initial_value ?? variable?.value;
        return tryParseJson(val);
      },
      set: (key, value) => {
        if (value === undefined || value === null) { envUpdates[key] = ''; return; }
        envUpdates[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      },
      unset: (key) => {
        envUpdates[key] = null; // Mark for deletion
      },
      toObject: () => {
        const obj = {};
        if (environment?.variables) {
          environment.variables.forEach(v => {
            if (v.enabled && v.key) {
              // Use current_value if set, fallback to initial_value
              obj[v.key] = v.current_value ?? v.initial_value ?? v.value;
            }
          });
        }
        // Apply updates
        Object.entries(envUpdates).forEach(([key, value]) => {
          if (value === null) {
            delete obj[key];
          } else {
            obj[key] = value;
          }
        });
        return obj;
      },
      // Internal: Get all updates to apply after script execution
      _getUpdates: () => envUpdates,
    },

    // Collection variable operations
    collectionVariables: {
      get: (key) => {
        if (key in collectionVarUpdates) {
          return tryParseJson(collectionVarUpdates[key]);
        }
        if (!collectionVariables) return undefined;
        const variable = collectionVariables.find(v => v.key === key && v.enabled);
        const val = variable?.current_value ?? variable?.initial_value ?? variable?.value;
        return tryParseJson(val);
      },
      set: (key, value) => {
        if (value === undefined || value === null) { collectionVarUpdates[key] = ''; return; }
        collectionVarUpdates[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      },
      unset: (key) => {
        collectionVarUpdates[key] = null;
      },
      _getUpdates: () => collectionVarUpdates,
    },

    // Request object (primarily for pre-script)
    request: request ? {
      url: request.url || '',
      method: request.method || 'GET',
      headers: request.headers || [],
      body: request.body || '',
      // Mutators
      setUrl: (url) => {
        if (onRequestUpdate) {
          onRequestUpdate({ url });
        }
      },
      setMethod: (method) => {
        if (onRequestUpdate) {
          onRequestUpdate({ method });
        }
      },
      setHeader: (key, value) => {
        if (onRequestUpdate && request.headers) {
          const headers = [...request.headers];
          const existingIndex = headers.findIndex(h => h.key === key);
          if (existingIndex >= 0) {
            headers[existingIndex] = { ...headers[existingIndex], value };
          } else {
            headers.push({ key, value, enabled: true });
          }
          onRequestUpdate({ headers });
        }
      },
      setBody: (body) => {
        if (onRequestUpdate) {
          onRequestUpdate({ body });
        }
      },
    } : null,

    // Response object (for post-script)
    response: response ? {
      code: response.status || 0,
      status: response.statusText || '',
      headers: response.headers || [],
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      responseTime: response.time || 0,
      json: () => {
        if (typeof response.body === 'object') {
          return response.body;
        }
        try {
          return JSON.parse(response.body);
        } catch (e) {
          throw new Error('Response body is not valid JSON');
        }
      },
      text: () => {
        return typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      },
    } : null,

    // Variables — Postman's transient "local" scope. Distinct from the
    // environment: pm.variables.set does NOT persist to the active environment
    // (and works even when there is no active environment). Resolution order on
    // get: local > environment > collection. (GH-59)
    variables: {
      get: (key) => {
        if (key in localUpdates) {
          return tryParseJson(localUpdates[key]);
        }
        const envVal = pm.environment.get(key);
        if (envVal !== undefined) return envVal;
        return pm.collectionVariables.get(key);
      },
      set: (key, value) => {
        if (value === undefined || value === null) { localUpdates[key] = ''; return; }
        localUpdates[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      },
      unset: (key) => {
        delete localUpdates[key];
      },
      // Internal: Get all local variables (seed + script-set) for substitution.
      _getUpdates: () => localUpdates,
    },

    // Test function (simplified - just logs for now)
    test: (name, fn) => {
      try {
        fn();
        console.log(`✓ ${name}`);
      } catch (e) {
        console.error(`✗ ${name}: ${e.message}`);
      }
    },

    // Expect (simplified assertion helper)
    expect: (value) => ({
      to: {
        equal: (expected) => {
          if (value !== expected) {
            throw new Error(`Expected ${expected} but got ${value}`);
          }
        },
        eql: (expected) => {
          if (JSON.stringify(value) !== JSON.stringify(expected)) {
            throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(value)}`);
          }
        },
        be: {
          a: (type) => {
            if (typeof value !== type) {
              throw new Error(`Expected type ${type} but got ${typeof value}`);
            }
          },
          an: (type) => {
            if (typeof value !== type) {
              throw new Error(`Expected type ${type} but got ${typeof value}`);
            }
          },
        },
        have: {
          property: (prop) => {
            if (!(prop in value)) {
              throw new Error(`Expected object to have property ${prop}`);
            }
          },
        },
        include: (item) => {
          if (Array.isArray(value)) {
            if (!value.includes(item)) {
              throw new Error(`Expected array to include ${item}`);
            }
          } else if (typeof value === 'string') {
            if (!value.includes(item)) {
              throw new Error(`Expected string to include ${item}`);
            }
          }
        },
      },
    }),
  };

  return pm;
}

/**
 * Execute a script in a sandboxed context
 * @param {string} script - The JavaScript code to execute
 * @param {Object} context - The execution context
 * @returns {Object} Result with logs, errors, and environment updates
 */
export async function executeScript(script, context) {
  if (!script || !script.trim()) {
    // Preserve the seeded local scope so an empty/whitespace script in a chain
    // doesn't wipe vars set by earlier scripts in the same request execution.
    return { success: true, logs: [], errors: [], envUpdates: {}, collectionVarUpdates: {}, varUpdates: { ...(context?.localVariables || {}) } };
  }

  const logs = [];
  const errors = [];

  // Create pm object
  const pm = createPmObject(context);

  // Create custom console that captures output
  const customConsole = {
    log: (...args) => {
      logs.push({ type: 'log', message: args.map(formatArg).join(' ') });
    },
    info: (...args) => {
      logs.push({ type: 'info', message: args.map(formatArg).join(' ') });
    },
    warn: (...args) => {
      logs.push({ type: 'warn', message: args.map(formatArg).join(' ') });
    },
    error: (...args) => {
      logs.push({ type: 'error', message: args.map(formatArg).join(' ') });
    },
  };

  try {
    // Create a function with pm and console in scope
    // Using Function constructor for basic sandboxing
    const fn = new Function('pm', 'console', `
      "use strict";
      ${script}
    `);

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Script execution timed out (5s)')), 5000);
    });

    const executionPromise = Promise.resolve().then(() => fn(pm, customConsole));

    await Promise.race([executionPromise, timeoutPromise]);

    return {
      success: true,
      logs,
      errors,
      envUpdates: pm.environment._getUpdates(),
      collectionVarUpdates: pm.collectionVariables._getUpdates(),
      varUpdates: pm.variables._getUpdates(),
    };
  } catch (error) {
    errors.push({
      type: 'error',
      message: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      logs,
      errors,
      envUpdates: pm.environment._getUpdates(),
      collectionVarUpdates: pm.collectionVariables._getUpdates(),
      varUpdates: pm.variables._getUpdates(),
    };
  }
}

/**
 * Format an argument for console output
 */
function formatArg(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * Apply environment updates to the environment object
 * Updates current_value (private/user-specific) NOT initial_value (shared)
 * @param {Object} environment - Current environment
 * @param {Object} updates - Updates from script execution
 * @returns {Object} Updated environment with modified current_value fields
 */
export function applyEnvironmentUpdates(environment, updates) {
  if (!environment || !updates || Object.keys(updates).length === 0) {
    return environment;
  }

  const variables = [...(environment.variables || [])];

  Object.entries(updates).forEach(([key, value]) => {
    const existingIndex = variables.findIndex(v => v.key === key);

    if (value === null) {
      // Clear the current_value (don't delete the variable itself)
      if (existingIndex >= 0) {
        variables[existingIndex] = { ...variables[existingIndex], current_value: '' };
      }
    } else if (existingIndex >= 0) {
      // Update existing variable's current_value
      variables[existingIndex] = { ...variables[existingIndex], current_value: value };
    } else {
      // Add new variable with current_value (empty initial_value)
      variables.push({ key, initial_value: '', current_value: value, enabled: true });
    }
  });

  return { ...environment, variables };
}

/**
 * Apply collection-variable updates to the in-memory collection variables list.
 * Parity with applyEnvironmentUpdates (GH-62): a key set from a script that is
 * not yet declared is appended (empty initial_value + script current_value) so
 * it resolves in the current request — mirroring pm.environment.set. Updates the
 * per-user current_value, never the shared initial_value.
 * @param {Array} collectionVariables - Current collection variables (key/value/current_value/...)
 * @param {Object} updates - Updates from script execution ({ key: value | null })
 * @returns {Array} Updated collection variables list
 */
export function applyCollectionVariableUpdates(collectionVariables, updates) {
  const variables = [...(collectionVariables || [])];
  if (!updates || Object.keys(updates).length === 0) {
    return variables;
  }

  Object.entries(updates).forEach(([key, value]) => {
    if (!key) return;
    const existingIndex = variables.findIndex(v => v.key === key);

    // Empty/null clears the per-user current_value — matching the persistence
    // layer (updateCollectionVariableCurrentValues), which deletes the user
    // value so the variable falls back to its shared initial_value. Keeping the
    // two layers symmetric avoids a brief mismatch between the in-request value
    // and what the popover shows after the post-execution reload.
    if (value === null || value === '') {
      if (existingIndex >= 0) {
        variables[existingIndex] = {
          ...variables[existingIndex],
          current_value: '',
          value: variables[existingIndex].initial_value || '',
        };
      }
      // An undeclared key cleared to empty has nothing meaningful to create.
    } else if (existingIndex >= 0) {
      variables[existingIndex] = {
        ...variables[existingIndex],
        current_value: value,
        value,
      };
    } else {
      // Auto-create on set, like the environment scope.
      variables.push({ key, initial_value: '', current_value: value, value, enabled: true });
    }
  });

  return variables;
}
