import { useCallback } from 'react';
import { isEqual, pick } from 'lodash-es';
import { useWebSocket } from './useWebSocket';
import { useWorkbench } from '../contexts/WorkbenchContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  upsertCollectionInState,
  removeCollectionBranch,
  upsertRequestInState,
  removeRequestFromState,
  patchRequestInState,
  upsertExampleInList,
} from '../utils/collectionState';
import * as data from '../data/index.js';

export function useRealtimeSync() {
  const {
    openTabs,
    setCollections,
    setExamples,
    setConflictedTabs,
    setDeletedTabs,
    loadCollections,
    loadEnvironments,
    loadWorkflows,
    selectedRequest,
    examples,
    wasRecentlyModified,
  } = useWorkbench();

  const { activeWorkspace } = useWorkspace();

  const handleWebSocketMessage = useCallback(
    (message) => {
      const { event, data: payload } = message;
      if (event === 'request:update' && payload?.id) {
        const tabId = `request-${payload.id}`;
        if (wasRecentlyModified(tabId)) return;

        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          const parseJson = (v) => typeof v === 'string' ? JSON.parse(v || '[]') : (v || []);
          const normalized = { ...payload, headers: parseJson(payload.headers), params: parseJson(payload.params), form_data: parseJson(payload.form_data) };
          const requestContentFields = ['name', 'method', 'url', 'body', 'body_type', 'auth_type', 'auth_token', 'pre_script', 'post_script', 'headers', 'params', 'form_data'];
          const contentChanged = openTab.request && !isEqual(pick(normalized, requestContentFields), pick(openTab.request, requestContentFields));

          if (contentChanged) {
            setConflictedTabs(prev => ({ ...prev, [tabId]: payload }));
          }
        }
      }

      if (event === 'request:create' && payload?.id) {
        if (wasRecentlyModified(`request-${payload.id}`)) return;
      }

      if (event === 'example:update' && payload?.id) {
        const tabId = `example-${payload.id}`;
        if (wasRecentlyModified(tabId)) return;

        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          const exampleContentFields = ['name', 'request_data', 'response_data'];
          const contentChanged = openTab.example && !isEqual(pick(payload, exampleContentFields), pick(openTab.example, exampleContentFields));

          if (contentChanged) {
            setConflictedTabs(prev => ({ ...prev, [tabId]: payload }));
          }
        }
      }

      if (event === 'example:create' && payload?.id) {
        if (wasRecentlyModified(`example-${payload.id}`)) return;
      }

      // Handle request deletion - mark open tabs as deleted
      if (event === 'request:delete' && payload?.id) {
        const tabId = `request-${payload.id}`;
        if (wasRecentlyModified(tabId)) return;
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      // Handle example deletion - mark open tabs as deleted
      if (event === 'example:delete' && payload?.id) {
        const tabId = `example-${payload.id}`;
        if (wasRecentlyModified(tabId)) return;
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      // Skip own collection modifications
      if (
        (event === 'collection:create' || event === 'collection:update' || event === 'collection:delete') &&
        payload?.id && wasRecentlyModified(`collection-${payload.id}`)
      ) return;

      // Skip own request modifications
      if (
        (event === 'request:create' || event === 'request:update' || event === 'request:delete') &&
        payload?.id && wasRecentlyModified(`request-${payload.id}`)
      ) return;

      // Skip own example modifications
      if (
        (event === 'example:create' || event === 'example:update' || event === 'example:delete') &&
        payload?.id && wasRecentlyModified(`example-${payload.id}`)
      ) return;

      // Skip example events if parent request was recently modified (cascade delete)
      if (event === 'example:delete' && payload?.request_id && wasRecentlyModified(`request-${payload.request_id}`)) return;

      // Skip own import
      if (event === 'sync:import' && payload?.rootCollectionId && wasRecentlyModified(`collection-${payload.rootCollectionId}`)) return;

      // Handle delete events by updating state directly
      if (event === 'collection:delete' && payload?.id) {
        setCollections(prev => removeCollectionBranch(prev, payload.id));
        return;
      }

      if (event === 'request:delete' && payload?.id) {
        setCollections(prev => removeRequestFromState(prev, payload.id));
        return;
      }

      if (event === 'collection:create' && payload?.id) {
        setCollections(prev => upsertCollectionInState(prev, payload));
        return;
      }

      if (event === 'collection:update' && payload?.id) {
        setCollections(prev => upsertCollectionInState(prev, payload));
        return;
      }

      if ((event === 'request:create' || event === 'request:update' || event === 'request:move') && payload?.id) {
        data.getRequest(payload.id)
          .then((request) => { setCollections(prev => upsertRequestInState(prev, request)); })
          .catch((error) => { console.error(`Failed to sync websocket ${event}:`, error); });
        return;
      }

      if (event === 'request:reorder' && payload?.id) {
        data.getRequest(payload.id)
          .then((request) => { setCollections(prev => upsertRequestInState(prev, request)); })
          .catch((error) => { console.error('Failed to sync websocket request reorder:', error); });
        return;
      }

      if (event === 'example:create' && payload?.id) {
        const syncExampleCreate = async () => {
          try {
            const example = payload.request_id ? payload : await data.getExample(payload.id);
            const fullExample = example.request_data ? example : await data.getExample(example.id);

            setCollections(prev => patchRequestInState(prev, example.request_id, (request) => ({
              ...request,
              example_count: (request.example_count || 0) + 1,
            })));

            if (selectedRequest?.id === fullExample.request_id) {
              setExamples(prev => upsertExampleInList(prev, fullExample));
            }
          } catch (error) {
            console.error('Failed to sync websocket example create:', error);
          }
        };
        syncExampleCreate();
        return;
      }

      if (event === 'example:update' && payload?.id) {
        const syncExampleUpdate = async () => {
          try {
            const example = await data.getExample(payload.id);
            setCollections(prev => patchRequestInState(prev, example.request_id, (request) => ({ ...request })));
            if (selectedRequest?.id === example.request_id) {
              setExamples(prev => upsertExampleInList(prev, example));
            }
          } catch (error) {
            console.error('Failed to sync websocket example update:', error);
          }
        };
        syncExampleUpdate();
        return;
      }

      if (event === 'example:delete' && payload?.id) {
        const deletedExampleRequestId =
          payload.request_id
          || examples.find((example) => example.id === payload.id)?.request_id
          || openTabs.find((tab) => tab.id === `example-${payload.id}`)?.parentRequestId
          || null;

        if (deletedExampleRequestId) {
          setCollections(prev => patchRequestInState(prev, deletedExampleRequestId, (request) => ({
            ...request,
            example_count: Math.max(0, (request.example_count || 0) - 1),
          })));
        }

        setExamples(prev => prev.filter((example) => example.id !== payload.id));
        return;
      }

      if (event === 'sync:import') {
        loadCollections();
      }

      if (
        event === 'environment:create' || event === 'environment:update' || event === 'environment:delete' ||
        event === 'environment:activate' || event === 'environment:deactivate'
      ) {
        if (activeWorkspace?.id) loadEnvironments(activeWorkspace.id);
      }

      // Workflow realtime events
      if (event?.startsWith('workflow:')) {
        loadWorkflows();
        if (event === 'workflow:DELETE' && payload?.id) {
          const tabId = `workflow-${payload.id}`;
          const openTab = openTabs.find(t => t.id === tabId);
          if (openTab) setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }
    },
    [activeWorkspace?.id, examples, loadCollections, loadEnvironments, loadWorkflows, openTabs, selectedRequest?.id, setCollections, setExamples, wasRecentlyModified, setConflictedTabs, setDeletedTabs]
  );

  return useWebSocket(handleWebSocketMessage);
}
