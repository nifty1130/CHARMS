import type { ParamMatcher } from '@sveltejs/kit';
import { roles } from '$lib/roles';

const validRoles = new Set<string>(roles.map((r) => r.id));

export const match: ParamMatcher = (param) => validRoles.has(param);
