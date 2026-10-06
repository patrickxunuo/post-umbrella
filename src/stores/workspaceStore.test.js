// Use configured Vitest globals, matching existing mocked data-layer tests.
vi.mock('../data/index.js', () => ({ inviteUser: vi.fn() }));
import * as data from '../data/index.js';
import useWorkspaceStore from './workspaceStore.js';

describe('GH-77 invite result feedback', () => {
  let toast; let refresh;
  beforeEach(() => {
    vi.clearAllMocks();
    toast = { success: vi.fn(), error: vi.fn() };
    refresh = vi.fn().mockResolvedValue();
    useWorkspaceStore.setState({ _toast: toast, loadAllUsers: refresh });
  });
  it('uses added feedback and awaits refreshing users before resolving', async () => {
    let finish;
    refresh.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    data.inviteUser.mockResolvedValue({ action: 'added', email: 'member@example.com', workspace_names: ['Alpha', 'Beta'] });
    let complete = false;
    const pending = useWorkspaceStore.getState().handleInviteUser('member@example.com', 'reader', ['a', 'b']).then(result => { complete = true; return result; });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(complete).toBe(false);
    finish();
    expect(await pending).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('Added member@example.com to Alpha, Beta');
  });
  it('retains the new-email invitation message', async () => {
    data.inviteUser.mockResolvedValue({ action: 'invited' });
    await useWorkspaceStore.getState().handleInviteUser('new@example.com', 'reader', ['a']);
    expect(toast.success).toHaveBeenCalledWith('Invitation sent to new@example.com');
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('reports server errors without showing success or refreshing', async () => {
    data.inviteUser.mockRejectedValue(new Error('Failed to add user to workspaces'));
    await expect(useWorkspaceStore.getState().handleInviteUser('member@example.com', 'reader', ['a'])).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith('Failed to add user to workspaces');
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
