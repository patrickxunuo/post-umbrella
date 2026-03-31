import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Play, Square, Trash2, GripVertical, CheckCircle2, XCircle, Loader2, Circle, Clock, RotateCcw, Save } from 'lucide-react';
import { useWorkflowExecution } from '../hooks/useWorkflowExecution';
import { useDragPreview } from '../hooks/useDragPreview';
import { METHOD_COLORS } from '../constants/methodColors';

function StepStatusIcon({ status, size = 14 }) {
  switch (status) {
    case 'running':
      return <Loader2 size={size} className="workflow-step-spinner" />;
    case 'success':
      return <CheckCircle2 size={size} className="workflow-step-success" />;
    case 'failed':
      return <XCircle size={size} className="workflow-step-failed" />;
    default:
      return <Circle size={size} className="workflow-step-idle" />;
  }
}

export function WorkflowEditor({
  workflow,
  onWorkflowChange,
  onSave,
  dirty,
  canEdit,
  collections,
  activeEnvironment,
  runState: savedRunState,
  onRunStateChange,
  onOpenRequest,
  openTabs,
  setActiveEnvironment,
  pendingRun,
  onClearPendingRun,
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [bottomTab, setBottomTab] = useState('report');
  const stepsRef = useRef(null);
  const setDragPreview = useDragPreview();

  const { runState: hookRunState, runWorkflow, stopWorkflow, clearRunState: hookClearRunState } = useWorkflowExecution({
    activeEnvironment,
    collections,
    openTabs,
    setActiveEnvironment,
  });

  const runState = hookRunState || savedRunState;
  useEffect(() => {
    if (hookRunState) onRunStateChange?.(hookRunState);
  }, [hookRunState]);

  const clearRunState = useCallback(() => {
    hookClearRunState();
    onRunStateChange?.(null);
  }, [hookClearRunState, onRunStateChange]);

  // Auto-run when opened via sidebar play button
  useEffect(() => {
    if (pendingRun && steps.length > 0 && !isRunning) {
      onClearPendingRun?.();
      clearRunState();
      runWorkflow(steps, { collectionId: workflow?.collection_id });
    }
  }, [pendingRun]);

  const steps = workflow?.steps || [];
  const isRunning = runState?.running;

  // Build a lookup map: request ID → { name, method, rootCollectionId }
  const requestMap = useMemo(() => {
    const map = {};
    if (!collections) return map;
    const getRootId = (col) => {
      let c = col;
      while (c?.parent_id) { c = collections.find(x => x.id === c.parent_id); }
      return c?.id;
    };
    const walk = (items) => {
      for (const col of items) {
        const rootId = getRootId(col);
        if (col.requests) {
          for (const req of col.requests) {
            map[req.id] = { id: req.id, name: req.name, method: req.method || 'GET', collectionName: col.name, rootCollectionId: rootId };
          }
        }
        if (col.children) walk(col.children);
      }
    };
    walk(collections);
    return map;
  }, [collections]);

  // Derive the workflow's root collection from its collection_id or first step
  const workflowRootCollectionId = workflow?.collection_id || (steps.length > 0 ? requestMap[steps[0]]?.rootCollectionId : null);

  const isRequestAllowed = useCallback((requestId) => {
    if (!workflowRootCollectionId) return true; // no constraint yet
    const req = requestMap[requestId];
    return req?.rootCollectionId === workflowRootCollectionId;
  }, [workflowRootCollectionId, requestMap]);

  // Wrapper: any step mutation clears previous run results
  const updateSteps = useCallback((newSteps) => {
    if (runState) clearRunState();
    onWorkflowChange({ steps: newSteps });
  }, [onWorkflowChange, runState, clearRunState]);

  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e) => {
    if (!e.dataTransfer.types.includes('text/x-request-id')) return;
    e.preventDefault();
    dragCounterRef.current++;
    stepsRef.current?.classList.add('drag-over');
  }, []);

  const handleDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('text/x-request-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      stepsRef.current?.classList.remove('drag-over');
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    stepsRef.current?.classList.remove('drag-over');
    setDragOverIndex(null);
    const requestId = e.dataTransfer.getData('text/x-request-id');
    if (requestId) {
      if (!isRequestAllowed(requestId)) return;
      updateSteps([...steps, requestId]);
    }
  }, [steps, updateSteps, isRequestAllowed]);

  const removeStep = useCallback((index) => {
    updateSteps(steps.filter((_, i) => i !== index));
  }, [steps, updateSteps]);

  // Internal reorder via drag
  const handleStepDragStart = useCallback((e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    const req = requestMap[steps[index]];
    if (req) {
      setDragPreview(e, `${req.method} ${req.name}`, METHOD_COLORS[req.method]);
    }
  }, [steps, requestMap, setDragPreview]);

  const handleStepDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = draggedIndex !== null ? 'move' : 'copy';
    setDragOverIndex(index);
  }, [draggedIndex]);

  const handleStepDrop = useCallback((e, targetIndex) => {
    e.preventDefault();
    e.stopPropagation();

    // External drop from sidebar — insert at this position
    const externalRequestId = e.dataTransfer.getData('text/x-request-id');
    if (externalRequestId && draggedIndex === null) {
      if (!isRequestAllowed(externalRequestId)) return;
      const newSteps = [...steps];
      newSteps.splice(targetIndex + 1, 0, externalRequestId);
      updateSteps(newSteps);
      return;
    }

    // Internal reorder
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newSteps = [...steps];
    const [moved] = newSteps.splice(draggedIndex, 1);
    newSteps.splice(targetIndex, 0, moved);
    updateSteps(newSteps);
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, steps, updateSteps]);

  const handleStepDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleRun = useCallback(() => {
    clearRunState();
    runWorkflow(steps);
  }, [steps, runWorkflow, clearRunState]);

  const handleRunFromStep = useCallback((index) => {
    clearRunState();
    runWorkflow(steps, { startFromIndex: index, collectionId: workflow?.collection_id });
  }, [steps, runWorkflow, clearRunState]);

  const handleStepDoubleClick = useCallback((stepId) => {
    const req = requestMap[stepId];
    if (req && onOpenRequest) {
      onOpenRequest({ id: req.id, name: req.name, method: req.method });
    }
  }, [requestMap, onOpenRequest]);

  // Summary
  const summary = useMemo(() => {
    if (!runState) return null;
    const passed = runState.results.filter(r => r.status === 'success').length;
    const failed = runState.results.filter(r => r.status === 'failed').length;
    const totalTime = runState.results.reduce((sum, r) => sum + (r.time || 0), 0);
    return { passed, failed, total: steps.length, totalTime };
  }, [runState, steps.length]);

  // Aggregate real console logs from all step results
  const consoleLogs = useMemo(() => {
    if (!runState) return [];
    const logs = [];
    runState.results.forEach((r) => {
      if (r.consoleLogs) {
        logs.push(...r.consoleLogs);
      }
    });
    return logs;
  }, [runState]);

  return (
    <div className="workflow-editor">
      <div className="workflow-body">
        {/* Left: Steps + Controls */}
        <div className="workflow-left">
          <div className="workflow-controls">
            <div className="workflow-controls-left">
              {isRunning ? (
                <button className="btn-danger small" onClick={stopWorkflow}>
                  <Square size={13} />
                  Stop
                </button>
              ) : (
                <button className="btn-primary small" onClick={handleRun} disabled={steps.length === 0}>
                  <Play size={13} />
                  Run Flow
                </button>
              )}
              {runState && !isRunning && (
                <button className="btn-secondary small" onClick={clearRunState}>
                  <RotateCcw size={13} />
                  Clear
                </button>
              )}
            </div>
            <div className="workflow-controls-right">
              {dirty && canEdit && (
                <button className="btn-primary small" onClick={onSave}>
                  <Save size={13} />
                  Save
                </button>
              )}
            </div>
          </div>
          <div
            className="workflow-steps"
            ref={stepsRef}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {steps.length === 0 ? (
              <div className="workflow-empty">
                <p>Drag requests from the sidebar to build your workflow</p>
              </div>
            ) : (
              steps.map((stepId, index) => {
                const req = requestMap[stepId];
                const result = runState?.results[index];
                const isCurrent = isRunning && runState?.currentStep === index;

                return (
                  <div
                    key={`${stepId}-${index}`}
                    className={`workflow-step ${result?.status || 'idle'} ${isCurrent ? 'current' : ''} ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                    draggable={canEdit && !isRunning}
                    onDragStart={(e) => handleStepDragStart(e, index)}
                    onDragOver={(e) => handleStepDragOver(e, index)}
                    onDrop={(e) => handleStepDrop(e, index)}
                    onDragEnd={handleStepDragEnd}
                    onDoubleClick={() => handleStepDoubleClick(stepId)}
                  >
                    <div className="workflow-step-main">
                      <span className={`workflow-step-grip ${isRunning ? 'disabled' : ''}`}>
                        <GripVertical size={14} />
                      </span>
                      <span className="workflow-step-number">{index + 1}</span>
                      <StepStatusIcon status={result?.status || 'idle'} />
                      {req ? (
                        <>
                          <span className="workflow-step-method" style={{ color: METHOD_COLORS[req.method] || '#888' }}>
                            {req.method}
                          </span>
                          <span className="workflow-step-name">{req.name}</span>
                        </>
                      ) : (
                        <span className="workflow-step-name missing">Unknown request</span>
                      )}
                      {result?.statusCode && (
                        <span className={`workflow-step-status-code ${result.status}`}>
                          {result.statusCode}
                        </span>
                      )}
                      {result?.time != null && (
                        <span className="workflow-step-time">{result.time}ms</span>
                      )}
                      <div className="workflow-step-actions">
                        {!isRunning && (
                          <button
                            className="btn-icon small"
                            onClick={(e) => { e.stopPropagation(); handleRunFromStep(index); }}
                            title="Run from this step"
                          >
                            <Play size={12} />
                          </button>
                        )}
                        {canEdit && !isRunning && (
                          <button
                            className="btn-icon small"
                            onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                            title="Remove step"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Report / Console */}
        <div className="workflow-right">
          <div className="response-toolbar">
            <div className="response-tabs">
              <button
                className={bottomTab === 'report' ? 'active' : ''}
                onClick={() => setBottomTab('report')}
              >
                Report
              </button>
              <button
                className={bottomTab === 'console' ? 'active' : ''}
                onClick={() => setBottomTab('console')}
              >
                Console
              </button>
            </div>
            {summary && (
              <div className="response-meta">
                <span className={`status ${summary.failed > 0 ? 'client-error' : 'success'}`}>
                  {summary.passed}/{summary.total} passed
                </span>
                <span className="time">{summary.totalTime}ms</span>
              </div>
            )}
          </div>
          <div className="workflow-right-content">
            {bottomTab === 'report' && (
              !summary ? (
                <div className="response-viewer empty">
                  <p>Run a flow to see the report</p>
                </div>
              ) : (
                <div className="workflow-report">
                  <div className={`workflow-summary ${summary.failed > 0 ? 'has-failures' : 'all-passed'}`}>
                    <span className="workflow-summary-stat">
                      <CheckCircle2 size={13} />
                      {summary.passed} passed
                    </span>
                    {summary.failed > 0 && (
                      <span className="workflow-summary-stat failed">
                        <XCircle size={13} />
                        {summary.failed} failed
                      </span>
                    )}
                    <span className="workflow-summary-stat">
                      <Clock size={13} />
                      {summary.totalTime}ms total
                    </span>
                    <span className="workflow-summary-stat">
                      {summary.passed + summary.failed}/{summary.total} steps
                    </span>
                  </div>
                  {runState.results.map((r, i) => {
                    if (r.status !== 'failed' || !r.error) return null;
                    const req = requestMap[steps[i]];
                    return (
                      <div key={i} className="workflow-step-error">
                        <div className="workflow-step-error-title">
                          Step {i + 1}: {req ? `${req.method} ${req.name}` : 'Unknown'} — {r.statusCode || 'Error'}
                        </div>
                        <pre>{typeof r.error === 'string' ? r.error.slice(0, 500) : JSON.stringify(r.error, null, 2).slice(0, 500)}</pre>
                      </div>
                    );
                  })}
                </div>
              )
            )}
            {bottomTab === 'console' && (
              <div className="workflow-console">
                {consoleLogs.length === 0 ? (
                  <div className="workflow-console-empty">No console output</div>
                ) : (
                  consoleLogs.map((log, i) => (
                    <div key={i} className={`console-line console-${log.type}`}>
                      <span className="console-source">{log.source}</span>
                      <span className="console-message">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
