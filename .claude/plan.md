# Environment Variables Refactor: Postman-like Model

## Executive Summary

Refactor environment variables from **collection-scoped with single values** to **workspace-scoped with Initial/Current value separation**, matching Postman's model for better team collaboration and security.

---

## Current State Analysis

### What We Have Now

| Aspect | Current Implementation |
|--------|----------------------|
| **Scope** | Collection-scoped (environments belong to root collection) |
| **Variables** | Single value: `{ key, value, enabled }` |
| **Sync** | All values sync to all users in real-time |
| **Active Selection** | Per-user, per-collection (good) |
| **Storage** | JSON array in `environments.variables` LONGTEXT column |

### Current Database Schema

```sql
-- Environments tied to collections
CREATE TABLE environments (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  variables LONGTEXT,           -- [{ key, value, enabled }]
  collection_id VARCHAR(36),    -- Currently scoped to collection
  created_by VARCHAR(36),
  updated_by VARCHAR(36),
  created_at INT,
  updated_at INT
);

-- Active environment per user per collection
CREATE TABLE user_active_environment (
  user_id VARCHAR(36) NOT NULL,
  collection_id VARCHAR(36) NOT NULL,  -- Currently scoped to collection
  environment_id VARCHAR(36),
  PRIMARY KEY (user_id, collection_id)
);
```

---

## Target State: Postman-like Model

### Key Principles

1. **Workspace-Scoped**: Environments belong to a workspace, available across all collections
2. **Initial Value (Shared)**: Team-visible, synced across workspace members
3. **Current Value (Private)**: User-specific, never synced, stored locally or in separate table
4. **Security-First**: Sensitive data (tokens, keys) stays in Current Value, not shared

### Variable Resolution Order

```
When substituting {{variable}}:
1. Check Current Value (user's private value)
2. If empty/undefined, fall back to Initial Value (shared)
```

---

## Proposed Database Schema

### Option A: Separate Table for Current Values (Recommended)

```sql
-- Environments now workspace-scoped
ALTER TABLE environments
  DROP FOREIGN KEY environments_ibfk_1,  -- Drop collection FK
  ADD COLUMN workspace_id VARCHAR(36),
  ADD FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- Rename for clarity: these are now "initial values"
-- variables column stays the same: [{ key, initial_value, enabled }]
-- (Consider renaming 'value' to 'initial_value' in JSON structure)

-- NEW: User-specific current values
CREATE TABLE environment_user_values (
  id VARCHAR(36) PRIMARY KEY,
  environment_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  variable_key VARCHAR(255) NOT NULL,
  current_value TEXT,
  updated_at INT,
  UNIQUE KEY unique_env_user_var (environment_id, user_id, variable_key),
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Update active environment to workspace scope
ALTER TABLE user_active_environment
  DROP PRIMARY KEY,
  DROP FOREIGN KEY user_active_environment_ibfk_2,  -- Drop collection FK
  DROP COLUMN collection_id,
  ADD COLUMN workspace_id VARCHAR(36) NOT NULL,
  ADD PRIMARY KEY (user_id, workspace_id),
  ADD FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
```

### Option B: Combined JSON with Separate Current Values Table

Keep `variables` as initial values, add user overrides table. Simpler migration.

### Option C: Expanded JSON Structure (Not Recommended)

Store both values in same JSON - complex, harder to query, sync issues.

**Recommendation: Option A** - cleanest separation, best for queries and sync logic.

---

## Migration Strategy

### Phase 1: Schema Migration

```sql
-- 1. Add workspace_id to environments (nullable initially)
ALTER TABLE environments ADD COLUMN workspace_id VARCHAR(36);

-- 2. Migrate existing environments to workspace
-- For each environment, find workspace via: environment → collection → workspace
UPDATE environments e
JOIN collections c ON e.collection_id = c.id
SET e.workspace_id = c.workspace_id
WHERE e.workspace_id IS NULL;

-- 3. Create user values table
CREATE TABLE environment_user_values (...);

-- 4. Update user_active_environment
-- Add workspace_id, migrate data, then drop collection_id

-- 5. Make workspace_id NOT NULL, drop collection_id
ALTER TABLE environments
  DROP COLUMN collection_id,
  MODIFY workspace_id VARCHAR(36) NOT NULL;
```

### Phase 2: Data Migration

- Existing `value` in variables becomes `initial_value`
- No current values exist yet (users will populate as they work)
- Active environment mapping: collection → workspace

### Phase 3: Rollback Plan

- Keep backup of old schema
- Feature flag to switch between old/new logic
- Gradual rollout with ability to revert

---

## API Changes

### Updated Endpoints

| Current | New | Change |
|---------|-----|--------|
| `GET /environments/collection/:collectionId` | `GET /environments/workspace/:workspaceId` | Scope change |
| `GET /environments/active/:collectionId` | `GET /environments/active/:workspaceId` | Scope change |
| `POST /environments` | `POST /environments` | Body: `workspace_id` instead of `collection_id` |
| `PUT /environments/:id` | `PUT /environments/:id` | Updates initial values only |
| N/A | `PUT /environments/:id/current-values` | **NEW**: Update user's current values |
| N/A | `GET /environments/:id/current-values` | **NEW**: Get user's current values |
| `PUT /environments/:id/activate` | `PUT /environments/:id/activate` | Now workspace-scoped |
| `POST /environments/deactivate/:collectionId` | `POST /environments/deactivate/:workspaceId` | Scope change |

### New Response Structure

```javascript
// GET /environments/workspace/:workspaceId
[
  {
    id: "env-uuid",
    name: "Production",
    workspace_id: "ws-uuid",
    variables: [
      {
        key: "api_url",
        initial_value: "https://api.example.com",
        current_value: "https://api.example.com",  // Merged from user table
        enabled: true
      },
      {
        key: "api_key",
        initial_value: "",  // Empty - team shouldn't see this
        current_value: "sk-secret-xxx",  // User's private value
        enabled: true
      }
    ],
    is_active: 1,
    created_by_email: "user@example.com"
  }
]
```

### Sync Behavior Changes

| Event | What Syncs | What Doesn't |
|-------|-----------|--------------|
| `environment:create` | Full environment (initial values) | N/A |
| `environment:update` | Initial values only | Current values |
| `environment:delete` | Deletion broadcast | Current values cleaned up server-side |
| `environment:activate` | Active selection | N/A |
| N/A | Never syncs | Current values (private) |

---

## Frontend Changes

### 1. useCollectionData.js → useEnvironmentData.js

```javascript
// Before: Load environments when request selected (via collection)
// After: Load environments when workspace changes

const loadEnvironments = useCallback(async (workspaceId) => {
  if (!user || !workspaceId) {
    setEnvironments([]);
    setActiveEnvironment(null);
    return;
  }
  const envs = await data.getEnvironments(workspaceId);
  // Server merges current_values for this user
  setEnvironments(envs);
  const active = envs.find(e => e.is_active);
  setActiveEnvironment(active || null);
}, [user]);

// Trigger: workspace change instead of request selection
useEffect(() => {
  if (activeWorkspace?.id) {
    loadEnvironments(activeWorkspace.id);
  }
}, [activeWorkspace?.id, loadEnvironments]);
```

### 2. EnvironmentEditor.jsx Updates

**New UI Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Manage Environments - [Workspace Name]                      [X] │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌─────────────────────────────────────────┐   │
│ │ Environments  │ │ Variables                               │   │
│ │               │ │                                         │   │
│ │ ● Production  │ │ ┌──────────┬─────────────┬─────────────┐│   │
│ │   Development │ │ │ Variable │ Initial Val │ Current Val ││   │
│ │   Staging     │ │ ├──────────┼─────────────┼─────────────┤│   │
│ │               │ │ │ api_url  │ https://... │ https://... ││   │
│ │ [+ Add]       │ │ │ api_key  │             │ sk-xxx...   ││   │
│ │               │ │ │ timeout  │ 30          │ 60          ││   │
│ └───────────────┘ │ └──────────┴─────────────┴─────────────┘│   │
│                   │                                         │   │
│                   │ [+ Add Variable]                        │   │
│                   │                                         │   │
│                   │ ℹ️ Initial values sync with team.        │   │
│                   │    Current values are private.          │   │
└───────────────────┴─────────────────────────────────────────┘   │
│                                        [Cancel] [Save Changes]  │
└─────────────────────────────────────────────────────────────────┘
```

**Key UI Changes:**
- Three-column variable table: Key, Initial Value, Current Value
- Visual distinction: Initial column shows "shared" icon, Current shows "private" icon
- Tooltip explaining the difference
- "Copy to Initial" button for each row (to share a current value)
- "Clear Current" to reset to initial value

### 3. EnvironmentSelector.jsx Updates

```javascript
// Change: Use workspaceId instead of collectionId
const EnvironmentSelector = ({
  environments,
  activeEnvironment,
  onEnvironmentChange,
  onOpenEditor,
  workspaceId,  // Changed from collectionId
}) => {
  // ... same UI, different data source
};
```

### 4. useResponseExecution.js - Variable Substitution

```javascript
const substituteWithEnv = (text) => {
  if (!text || !currentEnv) return text;

  let result = text;
  for (const variable of currentEnv.variables) {
    if (variable.enabled && variable.key) {
      // NEW: Prefer current_value, fall back to initial_value
      const value = variable.current_value ?? variable.initial_value ?? '';
      const regex = new RegExp(`\\{\\{${variable.key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    }
  }
  return result;
};
```

### 5. App.jsx WebSocket Handler Updates

```javascript
// Change event scope from collection to workspace
if (
  event === 'environment:create' ||
  event === 'environment:update' ||
  event === 'environment:delete' ||
  event === 'environment:activate' ||
  event === 'environment:deactivate'
) {
  // NEW: Check workspace match instead of collection
  if (activeWorkspace?.id) {
    loadEnvironments(activeWorkspace.id);
  }
}
```

---

## Implementation Phases

### Phase 1: Database & Backend (Days 1-2)

1. [ ] Create migration script for schema changes
2. [ ] Add `workspace_id` column, migrate data
3. [ ] Create `environment_user_values` table
4. [ ] Update API routes for workspace scope
5. [ ] Add current values endpoints
6. [ ] Update WebSocket broadcast logic
7. [ ] Add feature flag for gradual rollout

### Phase 2: Data Layer (Day 2)

1. [ ] Update `src/data/express/index.js` methods
2. [ ] Update `src/api/client.js` endpoints
3. [ ] Handle response structure changes

### Phase 3: Frontend - Core Logic (Day 3)

1. [ ] Update `useCollectionData.js` → environment loading by workspace
2. [ ] Update `WorkbenchContext.jsx` for new data flow
3. [ ] Update `useResponseExecution.js` for value resolution

### Phase 4: Frontend - UI Components (Days 3-4)

1. [ ] Redesign `EnvironmentEditor.jsx` with Initial/Current columns
2. [ ] Update `EnvironmentSelector.jsx` for workspace scope
3. [ ] Add "Copy to Initial" / "Clear Current" actions
4. [ ] Add visual indicators and tooltips

### Phase 5: Testing & Polish (Day 5)

1. [ ] Test multi-user sync behavior
2. [ ] Test current value isolation
3. [ ] Test migration from old data
4. [ ] Add help text explaining the model
5. [ ] Edge cases: empty values, special characters

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | High | Backup before migration, test on staging |
| Breaking existing workflows | Medium | Feature flag, gradual rollout |
| Sync complexity | Medium | Comprehensive testing, clear documentation |
| UI confusion | Low | Tooltips, onboarding hints |
| Performance (extra DB calls) | Low | Batch current values with environment fetch |

---

## Questions to Resolve

1. **Current Value Persistence**:
   - Store in database (server-side) or localStorage (client-side)?
   - Recommendation: Server-side for cross-device access

2. **Current Value Sync Option**:
   - Should users be able to opt-in to sync current values?
   - Postman doesn't allow this, keeps it simple

3. **Environment Permissions**:
   - Should some users be view-only for initial values?
   - Can wait for later iteration

4. **Import/Export**:
   - Include environments in collection export?
   - If yes, only initial values (security)

---

## Success Criteria

- [ ] Environments appear at workspace level in UI
- [ ] Initial values sync across team members
- [ ] Current values remain private per user
- [ ] Variable substitution prefers current over initial
- [ ] Existing environments migrated without data loss
- [ ] No degradation in real-time sync performance
