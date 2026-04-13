import { useCallback, useRef, useState } from 'react';
import JSON5 from 'json5';
import * as data from '../data/index.js';
import { applyEnvironmentUpdates, executeScript } from '../utils/scriptRunner';
import useWorkbenchStore from '../stores/workbenchStore';
import useConsoleStore from '../stores/consoleStore';

// Convert JSON5 (with comments) to standard JSON
function stripJsonComments(text) {
  if (!text?.trim()) return text;
  try {
    const parsed = JSON5.parse(text);
    return JSON.stringify(parsed);
  } catch {
    // If parsing fails, return as-is (let the API handle the error)
    return text;
  }
}

// Walk up the collection hierarchy to resolve inherited auth
function resolveInheritedAuth(collectionId, collections) {
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    if (col.auth_type && col.auth_type !== 'none' && col.auth_type !== 'inherit') {
      return { auth_type: col.auth_type, auth_token: col.auth_token || '' };
    }
    currentId = col.parent_id;
    iterations++;
  }
  return { auth_type: 'none', auth_token: '' };
}

// Collect pre/post scripts from root down to the request's collection
function resolveCollectionScripts(collectionId, collections) {
  const chain = [];
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    chain.unshift(col); // prepend so root is first
    currentId = col.parent_id;
    iterations++;
  }
  const preScripts = chain.map(c => c.pre_script).filter(Boolean);
  const postScripts = chain.map(c => c.post_script).filter(Boolean);
  return { preScripts, postScripts };
}

export function useResponseExecution({
  toast,
  activeTabId,
  activeEnvironment,
  activeWorkspaceId,
  collections,
  loadEnvironments,
  setActiveEnvironment,
  setOpenTabs,
}) {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const cancelRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleSendRequest = useCallback(async ({
    method,
    url,
    headers,
    body,
    bodyType,
    formData,
    authType: rawAuthType,
    authToken: rawAuthToken,
    preScript,
    postScript,
    collectionId,
  }) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    let scriptLogs = [];
    let consoleLogs = [];
    let currentEnv = activeEnvironment;

    // Get request name for global console tagging
    const activeTab = useWorkbenchStore.getState().openTabs.find(t => t.id === activeTabId);
    const requestName = activeTab?.request?.name || activeTab?.workflow?.name || url || 'Request';

    // Resolve inherited auth
    let authType = rawAuthType;
    let authToken = rawAuthToken;
    if (authType === 'inherit' && collectionId && collections) {
      const resolved = resolveInheritedAuth(collectionId, collections);
      authType = resolved.auth_type;
      authToken = resolved.auth_token;
    }

    // Collect and concatenate collection scripts
    let collectionPreScripts = [];
    let collectionPostScripts = [];
    if (collectionId && collections) {
      const scripts = resolveCollectionScripts(collectionId, collections);
      collectionPreScripts = scripts.preScripts;
      collectionPostScripts = scripts.postScripts;
    }

    // Combine: collection scripts run first (root→leaf), then request script
    const allPreScripts = [...collectionPreScripts, preScript].filter(Boolean);
    const allPostScripts = [...collectionPostScripts, postScript].filter(Boolean);

    try {
      consoleLogs.push({ type: 'info', source: 'system', message: `${method} ${url}`, timestamp: Date.now() });

      // Load collection variables (needed for both scripts and substitution)
      let collectionVars = [];
      let rootCollectionId = null;
      if (collectionId) {
        rootCollectionId = collectionId;
        if (collections) {
          let currentId = collectionId;
          let iterations = 0;
          while (currentId && iterations < 50) {
            const col = collections.find(c => c.id === currentId);
            if (!col) break;
            if (!col.parent_id) { rootCollectionId = col.id; break; }
            currentId = col.parent_id;
            iterations++;
          }
        }
        try {
          collectionVars = await data.getCollectionVariables(rootCollectionId);
        } catch {
          // Silently ignore — collection vars are optional
        }
      }

      // Execute all pre-scripts in order
      for (const script of allPreScripts) {
        const preResult = await executeScript(script, {
          environment: currentEnv,
          collectionVariables: collectionVars,
          request: { method, url, headers, body },
        });

        scriptLogs.push(...preResult.logs);
        consoleLogs.push(...preResult.logs.map(l => ({ ...l, source: 'pre-script', timestamp: Date.now() })));

        if (!preResult.success) {
          consoleLogs.push({ type: 'error', source: 'pre-script', message: `Error: ${preResult.errors[0]?.message || 'Unknown error'}`, timestamp: Date.now() });
          toast.error(`Pre-script error: ${preResult.errors[0]?.message || 'Unknown error'}`);
        }

        if (Object.keys(preResult.envUpdates).length > 0 && currentEnv) {
          currentEnv = applyEnvironmentUpdates(currentEnv, preResult.envUpdates);
          await data.updateCurrentValues(currentEnv.id, preResult.envUpdates);
          setActiveEnvironment(currentEnv);
        }

        if (Object.keys(preResult.collectionVarUpdates).length > 0 && rootCollectionId) {
          await data.updateCollectionVariableCurrentValues(rootCollectionId, preResult.collectionVarUpdates);
          collectionVars = await data.getCollectionVariables(rootCollectionId);
        }
      }

      const substituteWithEnv = (text) => {
        if (!text) return text;

        // Build merged map: collection (lower priority) then env (higher priority overrides).
        // Single substitution pass so env truly overrides — otherwise replacing collection first
        // erases the {{key}} pattern before env ever sees it.
        const resolved = new Map();
        for (const variable of collectionVars) {
          if (!variable.enabled || !variable.key) continue;
          resolved.set(variable.key, variable.value || variable.current_value || variable.initial_value || '');
        }
        if (currentEnv) {
          for (const variable of currentEnv.variables) {
            if (!variable.enabled || !variable.key) continue;
            resolved.set(variable.key, variable.value || variable.current_value || variable.initial_value || '');
          }
        }
        let result = text;
        for (const [key, value] of resolved) {
          result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
        }
        return result;
      };

      const resolvedUrl = substituteWithEnv(url);
      const resolvedHeaders = headers.map((header) => ({
        ...header,
        key: substituteWithEnv(header.key),
        value: substituteWithEnv(header.value),
      }));
      const resolvedBody = substituteWithEnv(body);
      const resolvedAuthToken = substituteWithEnv(authToken);
      const resolvedFormData = formData?.map((field) => ({
        ...field,
        key: substituteWithEnv(field.key),
        value: field.type === 'file' ? field.value : substituteWithEnv(field.value),
      }));

      if (bodyType === 'json' && resolvedBody) {
        const hasContentType = resolvedHeaders.some(
          (header) => header.key.toLowerCase() === 'content-type' && header.enabled !== false
        );
        if (!hasContentType) {
          resolvedHeaders.push({
            key: 'Content-Type',
            value: 'application/json',
            enabled: true,
          });
        }
      }

      if (authType === 'bearer' && resolvedAuthToken) {
        // Remove any existing Authorization header to avoid duplicates
        const filtered = resolvedHeaders.filter(h => h.key.toLowerCase() !== 'authorization');
        resolvedHeaders.length = 0;
        resolvedHeaders.push(...filtered, {
          key: 'Authorization',
          value: `Bearer ${resolvedAuthToken}`,
          enabled: true,
        });
      }

      const requestPayload = {
        method,
        url: resolvedUrl,
        headers: resolvedHeaders,
        bodyType,
      };

      if (bodyType === 'form-data') {
        requestPayload.formData = resolvedFormData?.filter(
          (field) => field.enabled !== false && field.key
        );
      } else if (bodyType === 'json') {
        // Strip comments from JSON body before sending
        requestPayload.body = stripJsonComments(resolvedBody);
      } else if (bodyType !== 'none') {
        requestPayload.body = resolvedBody;
      }

      if (resolvedUrl !== url) {
        consoleLogs.push({ type: 'info', source: 'system', message: `Resolved URL: ${resolvedUrl}`, timestamp: Date.now() });
      }

      const result = await data.sendRequest(requestPayload, { signal: controller.signal });

      // If cancelled while awaiting, skip everything
      if (controller.signal.aborted) return;

      consoleLogs.push({
        type: result.error ? 'error' : 'info',
        source: 'system',
        message: result.error
          ? `Request failed: ${result.body || result.statusText}`
          : `${result.status} ${result.statusText} — ${result.time}ms`,
        timestamp: Date.now(),
      });

      for (const script of allPostScripts) {
        const postResult = await executeScript(script, {
          environment: currentEnv,
          collectionVariables: collectionVars,
          response: result,
        });

        scriptLogs.push(...postResult.logs);
        consoleLogs.push(...postResult.logs.map(l => ({ ...l, source: 'post-script', timestamp: Date.now() })));

        if (!postResult.success) {
          consoleLogs.push({ type: 'error', source: 'post-script', message: `Error: ${postResult.errors[0]?.message || 'Unknown error'}`, timestamp: Date.now() });
          toast.error(`Post-script error: ${postResult.errors[0]?.message || 'Unknown error'}`);
        }

        if (Object.keys(postResult.envUpdates).length > 0 && currentEnv) {
          currentEnv = applyEnvironmentUpdates(currentEnv, postResult.envUpdates);
          await data.updateCurrentValues(currentEnv.id, postResult.envUpdates);
          setActiveEnvironment(currentEnv);
          if (activeWorkspaceId) {
            loadEnvironments(activeWorkspaceId);
          }
        }

        if (Object.keys(postResult.collectionVarUpdates).length > 0 && rootCollectionId) {
          await data.updateCollectionVariableCurrentValues(rootCollectionId, postResult.collectionVarUpdates);
          collectionVars = await data.getCollectionVariables(rootCollectionId);
        }
      }

      if (scriptLogs.length > 0) {
        console.group('Script Output');
        scriptLogs.forEach((log) => {
          console[log.type]?.(log.message) || console.log(log.message);
        });
        console.groupEnd();
      }

      setOpenTabs((prev) => prev.map((tab) => (
        tab.id === activeTabId ? { ...tab, response: { ...result, resolvedUrl, scriptLogs, consoleLogs } } : tab
      )));
      // Pin the tab so clicking another request doesn't replace it
      if (useWorkbenchStore.getState().previewTabId === activeTabId) {
        useWorkbenchStore.getState().setPreviewTabId(null);
      }

      // Push to global console
      if (consoleLogs.length > 0) {
        useConsoleStore.getState().addLogs(requestName, consoleLogs);
      }
    } catch (error) {
      if (error.name === 'AbortError' || controller.signal.aborted) {
        // Cancelled — keep previous response as-is
      } else {
        consoleLogs.push({ type: 'error', source: 'system', message: error.message, timestamp: Date.now() });
        setOpenTabs((prev) => prev.map((tab) => (
          tab.id === activeTabId
            ? {
                ...tab,
                response: {
                  status: 0,
                  statusText: 'Error',
                  body: error.message,
                  headers: [],
                  time: 0,
                  error: true,
                  scriptLogs,
                  consoleLogs,
                },
              }
            : tab
        )));

        // Push error to global console
        useConsoleStore.getState().addLogs(requestName, consoleLogs);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [activeEnvironment, activeTabId, activeWorkspaceId, collections, loadEnvironments, setActiveEnvironment, setOpenTabs, toast]);

  return {
    loading,
    handleSendRequest,
    cancelRequest,
  };
}
