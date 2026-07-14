import type { RoleId } from './roles';

const KEY_PREFIX = 'charmsexex:session:';

export function getSession(role: RoleId): unknown | null {
	if (typeof window === 'undefined') return null;
	const raw = window.localStorage.getItem(KEY_PREFIX + role);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function setSession(role: RoleId, data: unknown): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(KEY_PREFIX + role, JSON.stringify(data));
}

export function clearSession(role: RoleId): void {
	if (typeof window === 'undefined') return;
	window.localStorage.removeItem(KEY_PREFIX + role);
}
