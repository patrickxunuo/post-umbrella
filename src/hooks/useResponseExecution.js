import { useCallback, useState } from 'react';
import JSON5 from 'json5';
import * as data from '../data/index.js';
import { applyEnvironmentUpdates, executeScript } from '../utils/scriptRunner';

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

export function useResponseExecution({
  toast,
  activeTabId,
  activeEnvironment,
  activeWorkspaceId,
  loadEnvironments,
  setActiveEnvironment,
  setOpenTabs,
}) {
  const [loading, setLoading] = useState(false);

  const handleSendRequest = useCallback(async ({
    method,
    url,
    headers,
    body,
    bodyType,
    formData,
    authType,
    authToken,
    preScript,
    postScript,
  }) => {
    setLoading(true);
    let scriptLogs = [];
    let consoleLogs = [];
    let currentEnv = activeEnvironment;

    try {
      consoleLogs.push({ type: 'info', source: 'system', message: `${method} ${url}`, timestamp: Date.now() });

      if (preScript) {
        const preResult = await executeScript(preScript, {
          environment: currentEnv,
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
          // Save only current_values (private), not initial_value (shared)
          await data.updateCurrentValues(currentEnv.id, preResult.envUpdates);
          setActiveEnvironment(currentEnv);
        }
      }

      const substituteWithEnv = (text) => {
        if (!text || !currentEnv) return text;

        let result = text;
        for (const variable of currentEnv.variables) {
          if (variable.enabled && variable.key) {
            // Use computed value field (current_value || initial_value)
            const value = variable.value || variable.current_value || variable.initial_value || '';
            const regex = new RegExp(`\\{\\{${variable.key}\\}\\}`, 'g');
            result = result.replace(regex, value);
          }
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
        resolvedHeaders.push({
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

      const result = await data.sendRequest(requestPayload);

      consoleLogs.push({
        type: result.error ? 'error' : 'info',
        source: 'system',
        message: result.error
          ? `Request failed: ${result.body || result.statusText}`
          : `${result.status} ${result.statusText} — ${result.time}ms`,
        timestamp: Date.now(),
      });

      if (postScript) {
        const postResult = await executeScript(postScript, {
          environment: currentEnv,
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
          // Save only current_values (private), not initial_value (shared)
          await data.updateCurrentValues(currentEnv.id, postResult.envUpdates);
          setActiveEnvironment(currentEnv);
          if (activeWorkspaceId) {
            loadEnvironments(activeWorkspaceId);
          }
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
    } catch (error) {
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
    } finally {
      setLoading(false);
    }
  }, [activeEnvironment, activeTabId, activeWorkspaceId, loadEnvironments, setActiveEnvironment, setOpenTabs, toast]);

  return {
    loading,
    handleSendRequest,
  };
}
