import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Upload, X, ChevronDown, Play, Code } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { EnvVariableInput } from './EnvVariableInput';
import { MethodSelector } from './MethodSelector';
import { RequestBodyEditor } from './RequestBodyEditor';
import { ScriptEditor } from './ScriptEditor';
import { parseCurl } from './ImportCurlModal';
import { useToast } from './Toast';
import { reconcilePathVariables, sanitizeUrlForPathVars } from '../utils/substituteVariables';

// Parse URL query string to params array
function parseUrlParams(url) {
  try {
    const urlObj = new URL(url, 'http://placeholder');
    const params = [];
    urlObj.searchParams.forEach((value, key) => {
      params.push({ key, value, enabled: true });
    });
    // Always have an empty row for adding new params
    if (params.length === 0 || params[params.length - 1].key !== '') {
      params.push({ key: '', value: '', enabled: true });
    }
    return params;
  } catch {
    return [{ key: '', value: '', enabled: true }];
  }
}

// Build URL with params
function buildUrlWithParams(url, params) {
  try {
    // Split base URL and existing query
    const [baseUrl] = url.split('?');
    const enabledParams = params.filter(p => p.enabled && p.key.trim());
    if (enabledParams.length === 0) return baseUrl;

    const queryString = enabledParams
      .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return `${baseUrl}?${queryString}`;
  } catch {
    return url;
  }
}

// Escape single quotes for shell
function escapeShellArg(str) {
  if (!str) return '';
  return str.replace(/'/g, "'\\''");
}

// Generate cURL command from request
export function generateCurl(method, url, headers, body, bodyType, formData, authType, authToken) {
  const parts = ['curl'];

  // Add method
  if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }

  // Add URL (quote it)
  parts.push(`'${escapeShellArg(url)}'`);

  // Add headers (exclude Authorization if bearer auth is set, to avoid duplicates)
  const enabledHeaders = headers.filter(h => h.enabled !== false && h.key);
  for (const header of enabledHeaders) {
    if (authType === 'bearer' && authToken && header.key.toLowerCase() === 'authorization') continue;
    parts.push(`-H '${escapeShellArg(header.key)}: ${escapeShellArg(header.value)}'`);
  }

  // Add auth header
  if (authType === 'bearer' && authToken) {
    parts.push(`-H 'Authorization: Bearer ${escapeShellArg(authToken)}'`);
  }

  // Add body based on type
  if (bodyType === 'form-data' && formData) {
    const enabledFields = formData.filter(f => f.enabled !== false && f.key);
    for (const field of enabledFields) {
      if (field.type === 'file') {
        const filePath = field.filePath || field.fileName || 'file';
        parts.push(`--form '${escapeShellArg(field.key)}=@"${escapeShellArg(filePath)}"'`);
      } else {
        parts.push(`--form '${escapeShellArg(field.key)}=${escapeShellArg(field.value || '')}'`);
      }
    }
  } else if (bodyType !== 'none' && body) {
    // Escape single quotes in body
    const escapedBody = escapeShellArg(body);
    parts.push(`-d '${escapedBody}'`);
  }

  return parts.join(' \\\n  ');
}

export function RequestEditor({
  request,
  example,
  isExample,
  onSend,
  onCancel,
  onSave,
  onSaveAsExample,
  onTry,
  onRequestChange,
  loading,
  response,
  dirty,
  isTemporary,
  activeEnvironment,
  collectionVariables,
  rootCollectionId,
  onEnvironmentUpdate,
  height,
  activeDetailTab = 'params',
  onActiveDetailTabChange,
  canEdit = true,
  showCurlPanel,
  onToggleCurlPanel,
}) {
  const toast = useToast();
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState([{ key: '', value: '', enabled: true }]);
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState('none');
  const [formData, setFormData] = useState([{ key: '', value: '', type: 'text', enabled: true }]);
  const [authType, setAuthType] = useState('none');
  const [authToken, setAuthToken] = useState('');
  const [params, setParams] = useState([{ key: '', value: '', enabled: true }]);
  const [pathVariables, setPathVariables] = useState([]);
  const [preScript, setPreScript] = useState('');
  const [postScript, setPostScript] = useState('');
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  const [showExampleModal, setShowExampleModal] = useState(false);
  const [exampleName, setExampleName] = useState('');
  const lastUrlRef = useRef(url);
  const saveDropdownRef = useRef(null);

  // Initialize params from saved data or parse from URL
  const initializeParams = (savedParams, urlString) => {
    if (savedParams?.length > 0) {
      // Use saved params (includes disabled ones)
      const result = [...savedParams];
      // Ensure empty row at end
      if (result.length === 0 || result[result.length - 1].key !== '') {
        result.push({ key: '', value: '', enabled: true });
      }
      return result;
    }
    // Fall back to parsing from URL
    return parseUrlParams(urlString || '');
  };

  // Sync local state with request or example prop
  useEffect(() => {
    if (isExample && example) {
      const reqData = example.request_data || {};
      setMethod(reqData.method || 'GET');
      setUrl(reqData.url || '');
      const exHeaders = reqData.headers?.length > 0 ? [...reqData.headers] : [];
      if (exHeaders.length === 0 || exHeaders[exHeaders.length - 1].key !== '') {
        exHeaders.push({ key: '', value: '', enabled: true });
      }
      setHeaders(exHeaders);
      setBody(reqData.body || '');
      setBodyType(reqData.body_type || 'none');
      setFormData(
        reqData.form_data?.length > 0
          ? reqData.form_data
          : [{ key: '', value: '', type: 'text', enabled: true }]
      );
      setAuthType(reqData.auth_type || 'none');
      setAuthToken(reqData.auth_token || '');
      setParams(initializeParams(reqData.params, reqData.url));
      setPathVariables(reconcilePathVariables(reqData.url || '', reqData.path_variables || []));
      lastUrlRef.current = reqData.url || '';
    } else if (request) {
      setMethod(request.method || 'GET');
      setUrl(request.url || '');
      const reqHeaders = request.headers?.length > 0 ? [...request.headers] : [];
      if (reqHeaders.length === 0 || reqHeaders[reqHeaders.length - 1].key !== '') {
        reqHeaders.push({ key: '', value: '', enabled: true });
      }
      setHeaders(reqHeaders);
      setBody(request.body || '');
      setBodyType(request.body_type || 'none');
      setFormData(
        request.form_data?.length > 0
          ? request.form_data
          : [{ key: '', value: '', type: 'text', enabled: true }]
      );
      setAuthType(request.auth_type || 'none');
      setAuthToken(request.auth_token || '');
      setParams(initializeParams(request.params, request.url));
      setPathVariables(reconcilePathVariables(request.url || '', request.path_variables || []));
      setPreScript(request.pre_script || '');
      setPostScript(request.post_script || '');
      lastUrlRef.current = request.url || '';
    }
  }, [isExample, example?.id, example?.request_data, request?.id, request?.method, request?.url, request?.headers, request?.body, request?.body_type, request?.form_data, request?.auth_type, request?.auth_token, request?.params, request?.path_variables, request?.pre_script, request?.post_script]);

  // Helper to wrap changes for examples
  const notifyChange = (updates) => {
    if (isExample) {
      // For examples, wrap in request_data
      const currentRequestData = example?.request_data || {};
      onRequestChange?.({
        request_data: { ...currentRequestData, ...updates }
      });
    } else {
      onRequestChange?.(updates);
    }
  };

  // Notify parent of changes
  const handleMethodChange = (newMethod) => {
    setMethod(newMethod);
    notifyChange({ method: newMethod });
  };

  const handleUrlChange = (rawUrl) => {
    // Strip stray `:` followed by reserved chars (e.g. typing `/:/` collapses to `//`)
    const newUrl = sanitizeUrlForPathVars(rawUrl);
    setUrl(newUrl);

    // Sync params from URL while preserving disabled params
    const urlParams = parseUrlParams(newUrl);
    const disabledParams = params.filter(p => !p.enabled && p.key.trim());

    // Merge: URL params (enabled) + preserved disabled params + empty row
    const mergedParams = [
      ...urlParams.filter(p => p.key.trim()), // URL params without empty row
      ...disabledParams,
    ];

    // Ensure empty row at end
    if (mergedParams.length === 0 || mergedParams[mergedParams.length - 1].key !== '') {
      mergedParams.push({ key: '', value: '', enabled: true });
    }

    setParams(mergedParams);

    const newPathVars = reconcilePathVariables(newUrl, pathVariables);
    setPathVariables(newPathVars);

    lastUrlRef.current = newUrl;
    notifyChange({ url: newUrl, params: mergedParams, path_variables: newPathVars });
  };

  const handleUrlPaste = async (e) => {
    const text = e.clipboardData?.getData('text')?.trim();
    if (!text || !text.match(/^curl\s/i)) return;
    e.preventDefault();
    try {
      const parsed = parseCurl(text);
      if (!parsed.url) return;
      const pastedPathVars = reconcilePathVariables(parsed.url, []);
      setMethod(parsed.method);
      setUrl(parsed.url);
      setHeaders(parsed.headers);
      setParams(parseUrlParams(parsed.url).concat([{ key: '', value: '', enabled: true }]));
      setPathVariables(pastedPathVars);
      lastUrlRef.current = parsed.url;
      if (parsed.bodyType === 'form-data' && parsed.formData?.length > 0) {
        setBodyType('form-data');
        setBody('');
        setFormData(parsed.formData);
        notifyChange({
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers,
          body: '',
          body_type: 'form-data',
          form_data: parsed.formData,
          path_variables: pastedPathVars,
        });
      } else {
        setBodyType(parsed.bodyType);
        setBody(parsed.body);
        notifyChange({
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers,
          body: parsed.body,
          body_type: parsed.bodyType,
          path_variables: pastedPathVars,
        });
      }
      // Extract auth from parsed headers
      const authHeader = parsed.headers.find(h => h.key.toLowerCase() === 'authorization');
      if (authHeader && authHeader.value.toLowerCase().startsWith('bearer ')) {
        setAuthType('bearer');
        setAuthToken(authHeader.value.slice(7));
        setHeaders(prev => prev.filter(h => h.key.toLowerCase() !== 'authorization'));
      }
      toast.success('cURL command parsed successfully');
    } catch {
      // Not a valid curl — let normal paste happen
    }
  };

  const handleHeadersChange = (newHeaders) => {
    setHeaders(newHeaders);
    notifyChange({ headers: newHeaders });
  };

  const handleBodyChange = (newBody) => {
    setBody(newBody);
    notifyChange({ body: newBody });
  };

  const handleBodyTypeChange = (newBodyType) => {
    setBodyType(newBodyType);
    notifyChange({ body_type: newBodyType });
  };

  const handleFormDataChange = (newFormData) => {
    setFormData(newFormData);
    notifyChange({ form_data: newFormData });
  };

  const addFormDataField = () => {
    handleFormDataChange([...formData, { key: '', value: '', type: 'text', enabled: true }]);
  };

  const handleAuthTypeChange = (newAuthType) => {
    setAuthType(newAuthType);
    notifyChange({ auth_type: newAuthType });
  };

  const handleAuthTokenChange = (newToken) => {
    setAuthToken(newToken);
    notifyChange({ auth_token: newToken });
  };

  // Handle params change - updates URL
  const handleParamsChange = (newParams) => {
    // Ensure empty row at end for adding new params
    let paramsWithEmptyRow = [...newParams];
    if (paramsWithEmptyRow.length === 0 || paramsWithEmptyRow[paramsWithEmptyRow.length - 1].key !== '') {
      paramsWithEmptyRow.push({ key: '', value: '', enabled: true });
    }

    setParams(paramsWithEmptyRow);

    // Build URL only with enabled params
    const newUrl = buildUrlWithParams(url, paramsWithEmptyRow);
    setUrl(newUrl);
    lastUrlRef.current = newUrl;

    notifyChange({ url: newUrl, params: paramsWithEmptyRow });
  };

  const handleSend = () => {
    if (!isExample) {
      onSend({
        method,
        url,
        headers: headers.filter((h) => h.key),
        body,
        bodyType,
        formData: formData.filter((f) => f.key),
        authType,
        authToken,
        preScript,
        postScript,
        collectionId: request?.collection_id,
        pathVariables,
      });
    }
  };

  const handleSave = () => {
    // Normalize {{  key  }} → {{key}} in a string
    const trimVars = (s) => s ? s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, '{{$1}}') : s;

    // Filter out empty params but keep disabled ones
    const paramsToSave = params.filter((p) => p.key.trim()).map(p => ({ ...p, value: trimVars(p.value) }));
    const pathVarsToSave = pathVariables.map(pv => ({ ...pv, value: trimVars(pv.value) }));
    const trimmedUrl = trimVars(url).trim();
    const trimmedBody = trimVars(body);
    const trimmedHeaders = headers.filter((h) => h.key).map(h => ({ ...h, value: trimVars(h.value) }));
    const trimmedFormData = formData.filter((f) => f.key).map(f => ({ ...f, value: f.type === 'file' ? f.value : trimVars(f.value) }));
    const trimmedAuthToken = trimVars(authToken);

    if (isExample) {
      onSave({
        name: example?.name,
        request_data: {
          method,
          url: trimmedUrl,
          headers: trimmedHeaders,
          body: trimmedBody,
          body_type: bodyType,
          form_data: trimmedFormData,
          auth_type: authType,
          auth_token: trimmedAuthToken,
          params: paramsToSave,
          path_variables: pathVarsToSave,
        },
        response_data: example?.response_data,
      });
    } else {
      onSave({
        method,
        url: trimmedUrl,
        headers: trimmedHeaders,
        body: trimmedBody,
        body_type: bodyType,
        form_data: trimmedFormData,
        auth_type: authType,
        auth_token: trimmedAuthToken,
        params: paramsToSave,
        path_variables: pathVarsToSave,
        pre_script: preScript,
        post_script: postScript,
      });
    }
  };

  // Handle save as example
  const handleSaveAsExample = () => {
    const paramsToSave = params.filter((p) => p.key.trim());
    const requestData = {
      method,
      url,
      headers: headers.filter((h) => h.key),
      body,
      body_type: bodyType,
      form_data: formData.filter((f) => f.key),
      auth_type: authType,
      auth_token: authToken,
      params: paramsToSave,
      path_variables: pathVariables,
    };
    const responseData = response ? {
      status: response.status,
      statusText: response.statusText,
      body: response.body,
      headers: response.headers,
      time: response.time,
      size: response.size,
    } : null;

    onSaveAsExample?.(exampleName || 'New Example', requestData, responseData);
    setShowExampleModal(false);
    setExampleName('');
    setShowSaveDropdown(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (saveDropdownRef.current && !saveDropdownRef.current.contains(e.target)) {
        setShowSaveDropdown(false);
      }
    };
    if (showSaveDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSaveDropdown]);

  const updateHeader = (index, field, value) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    handleHeadersChange(newHeaders);
  };

  const removeHeader = (index) => {
    const newHeaders = headers.filter((_, i) => i !== index);
    if (newHeaders.length === 0) {
      newHeaders.push({ key: '', value: '', enabled: true });
    }
    handleHeadersChange(newHeaders);
  };

  if (!request && !example) {
    return (
      <div className="request-editor empty" style={height ? { height: `${height}px` } : undefined}>
        <p>Select a request or example from the sidebar</p>
      </div>
    );
  }

  return (
    <div className="request-editor" style={height ? { height: `${height}px` } : undefined}>
      <div className="request-bar">
        <MethodSelector
          value={method}
          onChange={handleMethodChange}
          disabled={!canEdit}
        />
        <EnvVariableInput
          className="url-input"
          placeholder="Enter request URL or paste cURL"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isExample && handleSend()}
          onPaste={canEdit ? handleUrlPaste : undefined}
          activeEnvironment={activeEnvironment}
          collectionVariables={collectionVariables}
          rootCollectionId={rootCollectionId}
          onEnvironmentUpdate={onEnvironmentUpdate}
          pathVariables={pathVariables}
          onPathVariableValueChange={(key, newValue) => {
            const updated = pathVariables.map(p =>
              p.key === key ? { ...p, value: newValue } : p
            );
            setPathVariables(updated);
            notifyChange({ path_variables: updated });
          }}
          disabled={!canEdit}
        />
        {isExample ? (
          <button
            className="btn-try"
            onClick={() => onTry?.({
              method,
              url,
              headers: headers.filter((h) => h.key),
              body,
              bodyType,
              formData: formData.filter((field) => field.key),
              authType,
              authToken,
              exampleName: example?.name,
              pathVariables,
            })}
            disabled={!url}
            title="Open in a new temporary tab to send request"
          >
            <ExternalLink size={14} />
            Try
          </button>
        ) : loading ? (
          <button className="btn-cancel-request" onClick={() => onCancel?.()}>
            Cancel
          </button>
        ) : (
          <button className="btn-send" onClick={handleSend} disabled={!url}>
            Send
          </button>
        )}
        {canEdit && (
          <div className="save-button-group" ref={saveDropdownRef}>
            <button
              className={`btn-save ${dirty ? 'dirty' : ''}`}
              onClick={handleSave}
              title={isExample ? 'Save example' : (isTemporary ? 'Save to collection' : 'Save request')}
            >
              Save{dirty ? ' *' : ''}
            </button>
            {!isExample && !isTemporary && (
              <button
                className="btn-save-dropdown"
                onClick={() => setShowSaveDropdown(!showSaveDropdown)}
                title="More save options"
              >
                <ChevronDown size={14} />
              </button>
            )}
            {showSaveDropdown && (
              <div className="save-dropdown-menu">
                <button
                  className="save-dropdown-item"
                  onClick={() => {
                    setShowSaveDropdown(false);
                    setShowExampleModal(true);
                  }}
                >
                  Save as Example...
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className={`btn-copy-curl${showCurlPanel ? ' active' : ''}`}
          onClick={() => onToggleCurlPanel?.()}
          title="cURL preview"
        >
          <Code size={14} />
        </button>
      </div>

      <div className="request-tabs">
        <button
          className={`${activeDetailTab === 'params' ? 'active' : ''} ${params.some(p => p.key) ? 'has-content' : ''}`}
          onClick={() => onActiveDetailTabChange?.('params')}
        >
          Params
        </button>
        <button
          className={`${activeDetailTab === 'auth' ? 'active' : ''} ${authType !== 'none' ? 'has-content' : ''}`}
          onClick={() => onActiveDetailTabChange?.('auth')}
        >
          Auth
        </button>
        <button
          className={`${activeDetailTab === 'headers' ? 'active' : ''} ${headers.some(h => h.key) ? 'has-content' : ''}`}
          onClick={() => onActiveDetailTabChange?.('headers')}
        >
          Headers
        </button>
        <button
          className={`${activeDetailTab === 'body' ? 'active' : ''} ${bodyType !== 'none' ? 'has-content' : ''}`}
          onClick={() => onActiveDetailTabChange?.('body')}
        >
          Body
        </button>
        {!isExample && (
          <>
            <button
              className={`script-tab ${activeDetailTab === 'pre-script' ? 'active' : ''} ${preScript ? 'has-content' : ''}`}
              onClick={() => onActiveDetailTabChange?.('pre-script')}
            >
              <Code size={12} />
              Pre-script
            </button>
            <button
              className={`script-tab ${activeDetailTab === 'post-script' ? 'active' : ''} ${postScript ? 'has-content' : ''}`}
              onClick={() => onActiveDetailTabChange?.('post-script')}
            >
              <Code size={12} />
              Post-script
            </button>
          </>
        )}
      </div>

      <div className="request-content">
        {activeDetailTab === 'params' && (
          <div className="params-editor">
            <div className="kv-section">
              <div className="kv-section-header">
                <span className="kv-section-title">Query Params</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '30px' }}></th>
                    <th>Key</th>
                    <th>Value</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((param, index) => (
                    <tr key={index}>
                      <td>
                        <Checkbox
                          checked={param.enabled !== false}
                          onChange={(e) => {
                            const newParams = [...params];
                            newParams[index] = { ...param, enabled: e.target.checked };
                            handleParamsChange(newParams);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="Key"
                          value={param.key}
                          onChange={(e) => {
                            const newParams = [...params];
                            newParams[index] = { ...param, key: e.target.value };
                            if (index === params.length - 1 && e.target.value) {
                              newParams.push({ key: '', value: '', enabled: true });
                            }
                            handleParamsChange(newParams);
                          }}
                        />
                      </td>
                      <td>
                        <EnvVariableInput
                          value={param.value}
                          onChange={(e) => {
                            const newParams = [...params];
                            newParams[index] = { ...param, value: e.target.value };
                            handleParamsChange(newParams);
                          }}
                          placeholder="Value"
                          activeEnvironment={activeEnvironment}
                          collectionVariables={collectionVariables}
                          rootCollectionId={rootCollectionId}
                          onEnvironmentUpdate={onEnvironmentUpdate}
                        />
                      </td>
                      <td>
                        {param.key && (
                          <button
                            className="btn-icon small danger"
                            onClick={() => {
                              const newParams = params.filter((_, i) => i !== index);
                              if (newParams.length === 0) {
                                newParams.push({ key: '', value: '', enabled: true });
                              }
                              handleParamsChange(newParams);
                            }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pathVariables.length > 0 && (
              <div className="kv-section" data-testid="path-variables-section">
                <div className="kv-section-header">
                  <span className="kv-section-title">Path Variables</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '30px' }}></th>
                      <th>Key</th>
                      <th>Value</th>
                      <th style={{ width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pathVariables.map((pv) => (
                      <tr key={pv.key} data-testid={`path-variable-row-${pv.key}`}>
                        <td></td>
                        <td>
                          <input
                            type="text"
                            className="path-var-key-readonly"
                            value={pv.key}
                            readOnly
                            tabIndex={-1}
                            data-testid={`path-variable-key-${pv.key}`}
                            title="Edit the URL above to change this key"
                          />
                        </td>
                        <td>
                          <EnvVariableInput
                            value={pv.value}
                            onChange={(e) => {
                              const updated = pathVariables.map(p =>
                                p.key === pv.key ? { ...p, value: e.target.value } : p
                              );
                              setPathVariables(updated);
                              notifyChange({ path_variables: updated });
                            }}
                            placeholder="Value"
                            activeEnvironment={activeEnvironment}
                            collectionVariables={collectionVariables}
                            rootCollectionId={rootCollectionId}
                            onEnvironmentUpdate={onEnvironmentUpdate}
                            data-testid={`path-variable-value-input-${pv.key}`}
                          />
                        </td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeDetailTab === 'auth' && (
          <div className="auth-editor">
            <div className="option-selector auth-type-selector">
              <label>
                <input
                  type="radio"
                  name="authType"
                  value="none"
                  checked={authType === 'none'}
                  onChange={() => handleAuthTypeChange('none')}
                />
                No Auth
              </label>
              <label>
                <input
                  type="radio"
                  name="authType"
                  value="inherit"
                  checked={authType === 'inherit'}
                  onChange={() => handleAuthTypeChange('inherit')}
                />
                Inherit from Parent
              </label>
              <label>
                <input
                  type="radio"
                  name="authType"
                  value="bearer"
                  checked={authType === 'bearer'}
                  onChange={() => handleAuthTypeChange('bearer')}
                />
                Bearer Token
              </label>
            </div>
            {authType === 'inherit' && (
              <p className="hint" style={{ marginTop: 8 }}>
                Authorization will be inherited from the parent collection's auth settings.
              </p>
            )}
            {authType === 'bearer' && (
              <div className="auth-token-input">
                <label>Token</label>
                <EnvVariableInput
                  className="auth-token-field"
                  placeholder="Enter bearer token or {{variable}}"
                  value={authToken}
                  onChange={(e) => handleAuthTokenChange(e.target.value)}
                  activeEnvironment={activeEnvironment}
                  collectionVariables={collectionVariables}
                  rootCollectionId={rootCollectionId}
                  onEnvironmentUpdate={onEnvironmentUpdate}
                />
                <p className="hint">
                  The token will be sent as: Authorization: Bearer &lt;token&gt;
                </p>
              </div>
            )}
          </div>
        )}

        {activeDetailTab === 'headers' && (
          <div className="headers-editor">
            <div className="kv-section">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Key</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header, index) => (
                    <tr key={index}>
                      <td>
                        <Checkbox
                          checked={header.enabled !== false}
                          onChange={(e) => updateHeader(index, 'enabled', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="Header name"
                          value={header.key}
                          onChange={(e) => {
                            const newHeaders = [...headers];
                            newHeaders[index] = { ...header, key: e.target.value };
                            if (index === headers.length - 1 && e.target.value) {
                              newHeaders.push({ key: '', value: '', enabled: true });
                            }
                            handleHeadersChange(newHeaders);
                          }}
                        />
                      </td>
                      <td>
                        <EnvVariableInput
                          value={header.value}
                          onChange={(e) => updateHeader(index, 'value', e.target.value)}
                          placeholder="Value"
                          activeEnvironment={activeEnvironment}
                          collectionVariables={collectionVariables}
                          rootCollectionId={rootCollectionId}
                          onEnvironmentUpdate={onEnvironmentUpdate}
                        />
                      </td>
                      <td>
                        {header.key && (
                          <button className="btn-icon small" onClick={() => removeHeader(index)}>
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeDetailTab === 'body' && (
          <RequestBodyEditor
            bodyType={bodyType}
            body={body}
            formData={formData}
            onBodyTypeChange={handleBodyTypeChange}
            onBodyChange={handleBodyChange}
            onFormDataChange={handleFormDataChange}
            activeEnvironment={activeEnvironment}
            collectionVariables={collectionVariables}
            rootCollectionId={rootCollectionId}
            onEnvironmentUpdate={onEnvironmentUpdate}
          />
        )}

        {activeDetailTab === 'pre-script' && (
          <div className="script-panel">
            <div className="script-help">
              <p>Pre-request script runs before the request is sent. Use it to set variables or modify request data.</p>
              <details>
                <summary>Available API</summary>
                <pre>{`// Environment variables
pm.environment.get("varName")
pm.environment.set("varName", "value")

// Collection variables
pm.collectionVariables.get("varName")
pm.collectionVariables.set("varName", "value")

// Access request data
pm.request.url
pm.request.method
pm.request.headers

// Console logging
console.log("message")`}</pre>
              </details>
            </div>
            <ScriptEditor
              value={preScript}
              onChange={(value) => {
                setPreScript(value);
                notifyChange({ pre_script: value });
              }}
              placeholder="// Pre-request script runs before sending the request..."
            />
          </div>
        )}

        {activeDetailTab === 'post-script' && (
          <div className="script-panel">
            <div className="script-help">
              <p>Post-response script runs after the response is received. Use it to extract data and set variables.</p>
              <details>
                <summary>Available API</summary>
                <pre>{`// Environment variables
pm.environment.get("varName")
pm.environment.set("varName", "value")

// Collection variables
pm.collectionVariables.get("varName")
pm.collectionVariables.set("varName", "value")

// Access response data
const json = pm.response.json();
pm.response.code    // status code
pm.response.body    // raw body
pm.response.headers

// Example: Extract token from response
const data = pm.response.json();
pm.environment.set("authToken", data.token);

// Console logging
console.log("message")`}</pre>
              </details>
            </div>
            <ScriptEditor
              value={postScript}
              onChange={(value) => {
                setPostScript(value);
                notifyChange({ post_script: value });
              }}
              placeholder="// Post-response script runs after receiving the response..."
            />
          </div>
        )}
      </div>

      {/* Save as Example Modal */}
      {showExampleModal && (
        <div className="modal-overlay" onClick={() => setShowExampleModal(false)}>
          <div className="modal-content save-example-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save as Example</h3>
            <p>Create an example from the current request{response ? ' and response' : ''}.</p>
            <input
              type="text"
              className="example-name-input"
              placeholder="Example name"
              value={exampleName}
              onChange={(e) => setExampleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAsExample();
                if (e.key === 'Escape') setShowExampleModal(false);
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowExampleModal(false)}>
                Cancel
              </button>
              <button className="btn-confirm" onClick={handleSaveAsExample}>
                Save Example
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
