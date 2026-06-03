import { describe, it, expect, beforeEach } from 'vitest';
import useCollectionStore from './collectionStore';

// GH-62 Part 2: a version counter consumers (useCollectionVariables) watch to
// reload collection variables after a script/workflow sets one — the same idea
// as setActiveEnvironment for the environment scope, so the VariablePopover
// reflects the live value without switching collections.
describe('GH-62: collectionVarsVersion bump', () => {
  beforeEach(() => {
    useCollectionStore.getState().reset();
  });

  it('starts at 0', () => {
    expect(useCollectionStore.getState().collectionVarsVersion).toBe(0);
  });

  it('bumpCollectionVars increments the counter', () => {
    useCollectionStore.getState().bumpCollectionVars();
    expect(useCollectionStore.getState().collectionVarsVersion).toBe(1);
    useCollectionStore.getState().bumpCollectionVars();
    expect(useCollectionStore.getState().collectionVarsVersion).toBe(2);
  });

  it('reset returns the counter to 0', () => {
    useCollectionStore.getState().bumpCollectionVars();
    useCollectionStore.getState().reset();
    expect(useCollectionStore.getState().collectionVarsVersion).toBe(0);
  });
});
