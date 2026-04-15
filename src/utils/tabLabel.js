// Derive a human-readable display name for a tab. Mirrors the label logic
// used by TabBar's render so confirm prompts and other UIs show the same
// name the user sees on the tab strip.
export function tabDisplayName(tab) {
  if (!tab) return 'Untitled';
  const isExample = tab.type === 'example';
  const isCollection = tab.type === 'collection';
  const isWorkflow = tab.type === 'workflow';
  const isDocs = tab.type === 'docs';
  const name = isDocs
    ? tab.docs?.collectionName
    : isWorkflow
      ? tab.workflow?.name
      : isCollection
        ? tab.collection?.name
        : isExample
          ? tab.example?.name
          : tab.request?.name;
  return name || 'Untitled';
}

// A temp tab counts as empty when it matches a freshly-created "New Request"
// with no user input in url, body, headers, params, form_data, or auth_token.
export function isEmptyTempRequest(tab) {
  if (!tab?.isTemporary) return false;
  const r = tab.request || {};
  const nameIsDefault = !r.name || r.name === 'New Request';
  const noUrl = !r.url;
  const noBody = !r.body;
  const noHeaders = !r.headers || r.headers.length === 0;
  const noParams = !r.params || r.params.length === 0;
  const noFormData = !r.form_data || r.form_data.length === 0;
  const noAuth = !r.auth_token;
  return nameIsDefault && noUrl && noBody && noHeaders && noParams && noFormData && noAuth;
}
