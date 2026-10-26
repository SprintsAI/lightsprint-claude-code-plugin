import { apiRequest } from './client.js';


/**
 * Resolve a stack reference (id, taskPrefix, or name) to a stack ID.
 * Returns null when no ref is given. Throws if no stack matches.
 */
export async function resolveStackId(workspaceId, ref) {
	if (!ref) return null;
	const data = await apiRequest(`/api/workspaces/${workspaceId}/stacks`);
	const stacks = data.stacks || [];
	const lc = String(ref).toLowerCase();
	const hit = stacks.find(s => s.id === ref)
		|| stacks.find(s => (s.taskPrefix || '').toLowerCase() === lc)
		|| stacks.find(s => (s.name || '').toLowerCase() === lc);
	if (!hit) throw new Error(`No stack matches "${ref}". Run "lightsprint stacks" to list stacks.`);
	return hit.id;
}
