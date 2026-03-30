/**
 * Cleanup helper for E2E tests.
 * Uses Supabase REST API with service role key to delete test data.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const headers = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

/**
 * Delete all collections (and cascading data) whose name contains the given timestamp.
 * This cleans up test data created during E2E runs.
 */
export async function cleanupTestCollections(timestamp: number | string) {
  try {
    // Find collections matching the timestamp (root collections only — cascading delete handles children)
    const searchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/collections?name=like.*${timestamp}*&parent_id=is.null&select=id,name`,
      { headers }
    );

    if (!searchRes.ok) return;
    const collections = await searchRes.json();
    if (!collections.length) return;

    // Delete each collection (cascading deletes requests, examples, variables, workflows)
    for (const col of collections) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/collections?id=eq.${col.id}`,
        { method: 'DELETE', headers }
      );
    }

    console.log(`Cleaned up ${collections.length} test collection(s) for timestamp ${timestamp}`);
  } catch (err) {
    console.warn('Cleanup failed (non-fatal):', err);
  }
}

/**
 * Delete all environments whose name contains the given timestamp.
 */
export async function cleanupTestEnvironments(timestamp: number | string) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/environments?name=like.*${timestamp}*&select=id`,
      { headers }
    );
    if (!res.ok) return;
    const envs = await res.json();
    if (!envs.length) return;

    for (const env of envs) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/environments?id=eq.${env.id}`,
        { method: 'DELETE', headers }
      );
    }
    console.log(`Cleaned up ${envs.length} test environment(s) for timestamp ${timestamp}`);
  } catch (err) {
    console.warn('Environment cleanup failed (non-fatal):', err);
  }
}

/**
 * Delete all workflows whose name contains the given timestamp.
 */
export async function cleanupTestWorkflows(timestamp: number | string) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workflows?name=like.*${timestamp}*&select=id`,
      { headers }
    );
    if (!res.ok) return;
    const workflows = await res.json();
    if (!workflows.length) return;

    for (const wf of workflows) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/workflows?id=eq.${wf.id}`,
        { method: 'DELETE', headers }
      );
    }
    console.log(`Cleaned up ${workflows.length} test workflow(s) for timestamp ${timestamp}`);
  } catch (err) {
    console.warn('Workflow cleanup failed (non-fatal):', err);
  }
}
