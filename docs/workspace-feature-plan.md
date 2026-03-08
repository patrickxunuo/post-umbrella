# Workspace Feature Assessment & Plan

## Overview
Introduce workspaces to organize collections by project/team, with role-based access control (RBAC) to manage permissions.

## Problem Statement
- All team members currently see all collections, creating clutter
- No way to organize collections by project
- No permission system to control who can edit vs. view
- No way to isolate work between different projects/teams

## Proposed Solution

### Core Concepts

**Workspace**: A container for collections that represents a project or team. Users can belong to multiple workspaces and switch between them.

**Collections in Multiple Workspaces**: A single collection can be linked to multiple workspaces, allowing shared resources across projects.

**User Creation**: Users are created by admins adding their email to the system. No invitation emails are sent - users simply receive the magic link login once their email exists in the database.

**Roles**: Three permission levels
| Role | Description |
|------|-------------|
| Reader | View-only access. Can view and send requests, but cannot modify anything |
| Developer | Full edit access within workspace. Can manage collections, requests, examples, environments |
| Admin | Full workspace control. Can manage members, roles, workspace settings, plus all developer permissions |

### Permission Matrix

| Action | Reader | Developer | Admin |
|--------|:------:|:---------:|:-----:|
| View collections/requests/examples | ✓ | ✓ | ✓ |
| Send requests | ✓ | ✓ | ✓ |
| Export collections | ✓ | ✓ | ✓ |
| Create/edit/delete collections | ✗ | ✓ | ✓ |
| Create/edit/delete requests | ✗ | ✓ | ✓ |
| Create/edit/delete examples | ✗ | ✓ | ✓ |
| Create/edit/delete environments | ✗ | ✓ | ✓ |
| Import collections | ✗ | ✓ | ✓ |
| Link/unlink collections to workspace | ✗ | ✗ | ✓ |
| Edit workspace name/settings | ✗ | ✗ | ✓ |
| Invite/remove users | ✗ | ✗ | ✓ |
| Change user roles | ✗ | ✗ | ✓ |
| Delete workspace | ✗ | ✗ | ✓ |
| Create new workspace | ✗ | ✗ | ✓* |

*Any user can create a new workspace (becomes admin of it)

---

## Database Schema Changes

### New Tables

```sql
-- Workspaces table
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Workspace members (junction table with roles)
CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('reader', 'developer', 'admin')),
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  PRIMARY KEY (workspace_id, user_id)
);

-- Workspace collections (junction table - collections can be in multiple workspaces)
CREATE TABLE workspace_collections (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  PRIMARY KEY (workspace_id, collection_id)
);

-- User's last active workspace (for remembering selection)
CREATE TABLE user_active_workspace (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL
);
```

### Indexes

```sql
CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX idx_workspace_collections_collection_id ON workspace_collections(collection_id);
CREATE INDEX idx_workspace_collections_workspace_id ON workspace_collections(workspace_id);
```

### User Creation Flow

Users are created via Supabase Auth admin API when an admin adds them to a workspace:
1. Admin enters email in "Add Member" form
2. Backend calls `supabase.auth.admin.createUser({ email })` to create user (if not exists)
3. User is added to `workspace_members` with specified role
4. User can now login via magic link (email must exist in auth.users)

### RLS Policies (Supabase)

```sql
-- Workspaces: Users can only see workspaces they're members of
CREATE POLICY "Users can view their workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Workspace members: Users can see members of their workspaces
CREATE POLICY "Users can view workspace members"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Workspace members: Only admins can modify
CREATE POLICY "Admins can manage workspace members"
  ON workspace_members FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Workspace collections: Users can see collections linked to their workspaces
CREATE POLICY "Users can view workspace collections"
  ON workspace_collections FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Workspace collections: Only admins can link/unlink collections
CREATE POLICY "Admins can manage workspace collections"
  ON workspace_collections FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Collections: Users can view if linked to any of their workspaces
CREATE POLICY "Users can view collections in their workspaces"
  ON collections FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT collection_id FROM workspace_collections
      WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    )
  );

-- Collections: Developers/admins can modify if linked to workspace they have edit rights
CREATE POLICY "Developers can modify collections"
  ON collections FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT collection_id FROM workspace_collections
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid() AND role IN ('developer', 'admin')
      )
    )
  );

-- Similar policies for requests, examples (inherit from collection permissions)
-- Requests: check if parent collection is in user's workspace
-- Examples: check if parent request's collection is in user's workspace
```

---

## Data Layer Changes

### New Functions

```javascript
// Workspace CRUD
getWorkspaces()                    // Get user's workspaces with role
getWorkspace(id)                   // Get single workspace with members
createWorkspace(name, description) // Create workspace (user becomes admin)
updateWorkspace(id, updates)       // Update workspace (admin only)
deleteWorkspace(id)                // Delete workspace (admin only)

// Member Management (admin only)
getWorkspaceMembers(workspaceId)   // List members with roles
addMember(workspaceId, email, role)  // Create user if needed, add to workspace
updateMemberRole(workspaceId, userId, role)  // Change role
removeMember(workspaceId, userId)  // Remove from workspace (doesn't delete user)

// Collection-Workspace Linking (admin only)
getWorkspaceCollections(workspaceId)  // Get collections in workspace
linkCollection(workspaceId, collectionId)  // Add collection to workspace
unlinkCollection(workspaceId, collectionId)  // Remove collection from workspace
getCollectionWorkspaces(collectionId)  // Get workspaces a collection belongs to

// Active Workspace
getActiveWorkspace()               // Get user's last active workspace
setActiveWorkspace(workspaceId)    // Set active workspace

// Permission Helpers
getUserRole(workspaceId)           // Get current user's role in workspace
canEdit(workspaceId)               // Check if user can edit (developer/admin)
isAdmin(workspaceId)               // Check if user is admin
```

### Modified Functions

All existing functions need workspace context:
- `getCollections(workspaceId)` - Filter by workspace via junction table
- `createCollection({ workspaceId, name, ... })` - Create and link to workspace
- Import scoped to workspace (imported collections auto-linked)
- Export can export single collection (already implemented)

---

## Frontend Changes

### New Components

1. **WorkspaceSelector** (header)
   - Dropdown showing user's workspaces with role badge
   - Shows current workspace name
   - Switch workspace action
   - "Create Workspace" option (for any user)
   - Settings gear icon (for admins)

2. **WorkspaceSettings** (modal, admin only)
   - Workspace name/description editing
   - Member list with roles
   - Add member form (email + role)
   - Role management (change/remove)
   - Link existing collections to workspace
   - Delete workspace (with confirmation)

3. **AddMemberForm**
   - Email input
   - Role selector (reader/developer/admin)
   - Creates user if doesn't exist, adds to workspace

4. **LinkCollectionModal**
   - Shows all collections user has access to
   - Checkbox to link/unlink from current workspace
   - Only available to admins

### UI Changes

1. **Header**: Add WorkspaceSelector next to environment selector

2. **Sidebar**:
   - Shows only collections from active workspace
   - Hide edit actions for readers
   - Show role badge/indicator
   - Collections can show "shared" indicator if in multiple workspaces

3. **Action Buttons**:
   - Hide/disable based on role
   - Import button: hidden for readers
   - Collection menu: hide add/edit/delete for readers
   - Request editor: disable save for readers

4. **Visual Indicators**:
   - "View Only" badge for readers
   - Role indicator in workspace selector
   - "Shared" badge on collections in multiple workspaces

---

## Implementation Phases

### Phase 1: Database & Schema
- [ ] Create migration file with new tables (workspaces, workspace_members, workspace_collections, user_active_workspace)
- [ ] Add RLS policies for all new tables
- [ ] Create indexes for performance

### Phase 2: Data Layer
- [ ] Workspace CRUD functions
- [ ] Member management functions (with Supabase Auth admin API for user creation)
- [ ] Collection-workspace linking functions
- [ ] Permission helper functions
- [ ] Update existing functions for workspace context
- [ ] Real-time subscriptions scoped to workspace

### Phase 3: Core Frontend
- [ ] WorkspaceSelector component
- [ ] Workspace context/state management
- [ ] Update App.jsx for workspace awareness
- [ ] Filter collections by workspace (via junction table)
- [ ] Permission-based UI visibility

### Phase 4: Admin Features
- [ ] WorkspaceSettings modal
- [ ] AddMemberForm (creates user if not exists)
- [ ] Member list with role management
- [ ] LinkCollectionModal for managing collection-workspace links
- [ ] Delete workspace functionality

### Phase 5: Migration & Polish
- [ ] Migration script for existing data
- [ ] Create "Default Workspace" for existing collections
- [ ] Link all existing collections to Default Workspace
- [ ] Make existing users admins of default workspace
- [ ] Testing & edge cases

---

## Migration Strategy

For existing data:
1. Create a "Default Workspace" automatically
2. Link all existing collections to Default Workspace (insert into workspace_collections)
3. Add all existing users as admins of Default Workspace (insert into workspace_members)
4. Set Default Workspace as active for all users (insert into user_active_workspace)

---

## Design Decisions (Resolved)

1. **User Creation**: Admin adds email to workspace. User is created via Supabase Auth admin API if not exists. No invitation emails - user can login via magic link once their email is in the system.

2. **No Invitation Expiry**: Simple database entry approach, no expiry mechanism needed.

3. **Collections in Multiple Workspaces**: Collections can be linked to multiple workspaces via junction table. Admins can link/unlink collections.

4. **User Must Exist to Login**: Magic link only works if email exists in auth.users (created by admin invitation).

5. **Any User Can Create Workspace**: User becomes admin of the workspace they create.

## Future Considerations

- Billing implications (workspaces tied to plans?)
- Member limits per workspace
- Storage/usage quotas per workspace

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Comprehensive migration script, default workspace |
| Complex RLS policies | Test thoroughly, use helper functions |
| Performance with many workspaces | Proper indexing, pagination |
| Confusion during transition | Clear UI indicators, onboarding |

---

## Success Criteria

1. Users can create and manage workspaces
2. Collections are properly scoped to workspaces
3. Role-based permissions work correctly
4. Existing data migrated seamlessly
5. Real-time sync works within workspace scope
6. No regression in existing functionality
