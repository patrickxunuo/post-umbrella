/**
 * Script Runner Utility
 * Executes pre-script and post-script with a Postman-like pm object
 */

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
    request,
    response,
    onRequestUpdate,
  } = context;

  // Store for variables set during script execution
  const envUpdates = {};

  const pm = {
    // Environment operations
    environment: {
      get: (key) => {
        // Check updates first, then existing environment
        if (key in envUpdates) {
          return envUpdates[key];
        }
        if (!environment?.variables) return undefined;
        const variable = environment.variables.find(v => v.key === key && v.enabled);
        // Use current_value if set, fallback to initial_value
        return variable?.current_value ?? variable?.initial_value ?? variable?.value;
      },
      set: (key, value) => {
        envUpdates[key] = String(value);
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

    // Variables (simplified - just aliases to environment for now)
    variables: {
      get: (key) => pm.environment.get(key),
      set: (key, value) => pm.environment.set(key, value),
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
    return { success: true, logs: [], errors: [], envUpdates: {} };
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
