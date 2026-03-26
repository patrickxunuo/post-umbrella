import { useState, useCallback, useRef } from 'react';
import JSON5 from 'json5';
import * as data from '../data/index.js';
import { applyEnvironmentUpdates, executeScript } from '../utils/scriptRunner';

function stripJsonComments(text) {
  if (!text?.trim()) return text;
  try {
    const parsed = JSON5.parse(text);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function resolveInheritedAuth(collectionId, collections) {
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    if (col.auth_type && col.auth_type !== 'inherit' && col.auth_type !== 'none') {
      return { auth_type: col.auth_type, auth_token: col.auth_token || '' };
    }
    currentId = col.parent_id;
    iterations++;
  }
  return { auth_type: 'none', auth_token: '' };
}

function getRootCollectionId(collectionId, collections) {
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    if (!col.parent_id) return col.id;
    currentId = col.parent_id;
    iterations++;
  }
  return currentId;
}

export function useWorkflowExecution({ activeEnvironment, collections, openTabs, setActiveEnvironment }) {
  const [runState, setRunState] = useState(null);
  const abortRef = useRef(null);

  const runWorkflow = useCallback(async (steps, { startFromIndex = 0, collectionId = null } = {}) => {
    const controller = new AbortController();
    abortRef.current = controller;

    const results = steps.map((_, i) => ({
      status: i < startFromIndex ? 'skipped' : 'idle',
      statusCode: null,
      time: null,
      error: null,
    }));

    let currentEnv = activeEnvironment;

    setRunState({ running: true, currentStep: startFromIndex, results, startTime: Date.now() });

    // Run root collection pre-script (once, before all steps)
    const rootCollection = collectionId ? collections?.find(c => c.id === collectionId) : null;
    if (rootCollection?.pre_script) {
      let collectionVars = [];
      try { collectionVars = await data.getCollectionVariables(collectionId); } catch {}
      const preResult = await executeScript(rootCollection.pre_script, {
        environment: currentEnv,
        collectionVariables: collectionVars,
      });
      if (Object.keys(preResult.envUpdates).length > 0 && currentEnv) {
        currentEnv = applyEnvironmentUpdates(currentEnv, preResult.envUpdates);
        await data.updateCurrentValues(currentEnv.id, preResult.envUpdates);
        setActiveEnvironment?.(currentEnv);
      }
      if (Object.keys(preResult.collectionVarUpdates).length > 0 && collectionId) {
        await data.updateCollectionVariableCurrentValues(collectionId, preResult.collectionVarUpdates);
      }
    }

    for (let i = startFromIndex; i < steps.length; i++) {
      if (controller.signal.aborted) break;

      results[i] = { status: 'running', statusCode: null, time: null, error: null };
      setRunState(prev => ({ ...prev, currentStep: i, results: [...results] }));

      try {
        const dirtyTab = openTabs?.find(t => t.type === 'request' && t.entityId === steps[i] && t.dirty);
        const request = dirtyTab ? dirtyTab.request : await data.getRequest(steps[i]);

        // Resolve auth
        let authType = request.auth_type || 'none';
        let authToken = request.auth_token || '';
        if (authType === 'inherit' && request.collection_id && collections) {
          const resolved = resolveInheritedAuth(request.collection_id, collections);
          authType = resolved.auth_type;
          authToken = resolved.auth_token;
        }

        // Only run the request's own pre/post scripts (not collection-level)
        const allPreScripts = [request.pre_script].filter(Boolean);
        const allPostScripts = [request.post_script].filter(Boolean);
        const stepLogs = [];

        stepLogs.push({ type: 'info', source: 'system', message: `${request.method || 'GET'} ${request.url}` });

        // Load collection variables (needed for scripts and substitution)
        let collectionVars = [];
        let rootId = null;
        if (request.collection_id && collections) {
          rootId = getRootCollectionId(request.collection_id, collections);
          try { collectionVars = await data.getCollectionVariables(rootId); } catch {}
        }

        // Execute pre-scripts
        for (const script of allPreScripts) {
          const preResult = await executeScript(script, {
            environment: currentEnv,
            collectionVariables: collectionVars,
            request: { method: request.method, url: request.url, headers: request.headers, body: request.body },
          });
          preResult.logs.forEach(l => stepLogs.push({ ...l, source: 'pre-script' }));
          if (!preResult.success) {
            stepLogs.push({ type: 'error', source: 'pre-script', message: `Error: ${preResult.errors[0]?.message || 'Unknown error'}` });
          }
          if (Object.keys(preResult.envUpdates).length > 0 && currentEnv) {
            currentEnv = applyEnvironmentUpdates(currentEnv, preResult.envUpdates);
            await data.updateCurrentValues(currentEnv.id, preResult.envUpdates);
            setActiveEnvironment?.(currentEnv);
          }
          if (Object.keys(preResult.collectionVarUpdates).length > 0 && rootId) {
            await data.updateCollectionVariableCurrentValues(rootId, preResult.collectionVarUpdates);
            collectionVars = await data.getCollectionVariables(rootId);
          }
        }

        // Substitute environment variables
        const substitute = (text) => {
          if (!text) return text;
          let result = text;
          for (const v of collectionVars) {
            if (v.enabled && v.key) {
              result = result.replace(new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, 'g'), v.value || v.current_value || v.initial_value || '');
            }
          }
          if (currentEnv) {
            for (const v of currentEnv.variables) {
              if (v.enabled && v.key) {
                result = result.replace(new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, 'g'), v.value || v.current_value || v.initial_value || '');
              }
            }
          }
          return result;
        };

        const resolvedUrl = substitute(request.url);
        const resolvedHeaders = (request.headers || [])
          .filter(h => h.enabled !== false)
          .map(h => ({ ...h, key: substitute(h.key), value: substitute(h.value) }));
        const resolvedBody = substitute(request.body);
        const resolvedAuthToken = substitute(authToken);
        const resolvedFormData = (request.form_data || [])
          .filter(f => f.enabled !== false)
          .map(f => ({ ...f, key: substitute(f.key), value: f.type === 'file' ? f.value : substitute(f.value) }));

        const bodyType = request.body_type || 'none';

        if (bodyType === 'json' && resolvedBody) {
          const hasContentType = resolvedHeaders.some(h => h.key.toLowerCase() === 'content-type' && h.enabled !== false);
          if (!hasContentType) {
            resolvedHeaders.push({ key: 'Content-Type', value: 'application/json', enabled: true });
          }
        }

        if (authType === 'bearer' && resolvedAuthToken) {
          const filtered = resolvedHeaders.filter(h => h.key.toLowerCase() !== 'authorization');
          resolvedHeaders.length = 0;
          resolvedHeaders.push(...filtered, { key: 'Authorization', value: `Bearer ${resolvedAuthToken}`, enabled: true });
        }

        const payload = {
          method: request.method || 'GET',
          url: resolvedUrl,
          headers: resolvedHeaders,
          bodyType,
        };

        if (bodyType === 'form-data') {
          payload.formData = resolvedFormData?.filter(f => f.enabled !== false && f.key);
        } else if (bodyType === 'json') {
          payload.body = stripJsonComments(resolvedBody);
        } else if (bodyType !== 'none' && resolvedBody) {
          payload.body = resolvedBody;
        }

        const result = await data.sendRequest(payload, { signal: controller.signal });

        if (controller.signal.aborted) break;

        stepLogs.push({
          type: result.error ? 'error' : 'info',
          source: 'system',
          message: result.error
            ? `Request failed: ${result.body || result.statusText}`
            : `${result.status} ${result.statusText} — ${result.time}ms`,
        });

        // Execute post-scripts
        for (const script of allPostScripts) {
          const postResult = await executeScript(script, {
            environment: currentEnv,
            collectionVariables: collectionVars,
            response: result,
          });
          postResult.logs.forEach(l => stepLogs.push({ ...l, source: 'post-script' }));
          if (!postResult.success) {
            stepLogs.push({ type: 'error', source: 'post-script', message: `Error: ${postResult.errors[0]?.message || 'Unknown error'}` });
          }
          if (Object.keys(postResult.envUpdates).length > 0 && currentEnv) {
            currentEnv = applyEnvironmentUpdates(currentEnv, postResult.envUpdates);
            await data.updateCurrentValues(currentEnv.id, postResult.envUpdates);
            setActiveEnvironment?.(currentEnv);
          }
          if (Object.keys(postResult.collectionVarUpdates).length > 0 && rootId) {
            await data.updateCollectionVariableCurrentValues(rootId, postResult.collectionVarUpdates);
            collectionVars = await data.getCollectionVariables(rootId);
          }
        }

        const failed = result.error || result.status >= 400;
        results[i] = {
          status: failed ? 'failed' : 'success',
          statusCode: result.status,
          time: result.time,
          error: failed ? (result.body || result.statusText || 'Request failed') : null,
          consoleLogs: stepLogs,
        };
        setRunState(prev => ({ ...prev, results: [...results] }));

        if (failed) break;
      } catch (err) {
        if (controller.signal.aborted) break;
        results[i] = {
          status: 'failed', statusCode: null, time: null, error: err.message,
          consoleLogs: [{ type: 'error', source: 'system', message: err.message }],
        };
        setRunState(prev => ({ ...prev, results: [...results] }));
        break;
      }
    }

    // Run root collection post-script (once, after all steps)
    if (rootCollection?.post_script && !controller.signal.aborted) {
      let collectionVars = [];
      try { collectionVars = await data.getCollectionVariables(collectionId); } catch {}
      const postResult = await executeScript(rootCollection.post_script, {
        environment: currentEnv,
        collectionVariables: collectionVars,
      });
      if (Object.keys(postResult.envUpdates).length > 0 && currentEnv) {
        currentEnv = applyEnvironmentUpdates(currentEnv, postResult.envUpdates);
        await data.updateCurrentValues(currentEnv.id, postResult.envUpdates);
        setActiveEnvironment?.(currentEnv);
      }
      if (Object.keys(postResult.collectionVarUpdates).length > 0 && collectionId) {
        await data.updateCollectionVariableCurrentValues(collectionId, postResult.collectionVarUpdates);
      }
    }

    setRunState(prev => prev ? { ...prev, running: false } : prev);
  }, [activeEnvironment, collections, openTabs, setActiveEnvironment]);

  const stopWorkflow = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearRunState = useCallback(() => {
    setRunState(null);
  }, []);

  return { runState, runWorkflow, stopWorkflow, clearRunState };
}
