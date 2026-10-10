/**
 * Composio's meta-tools answer with rich, nested payloads. Everything here reads those payloads
 * tolerantly: the node must still work if Composio renames a wrapper, so fields are looked up by
 * shape rather than by one hard-coded path.
 *
 * Shapes are taken from Composio's own documentation for COMPOSIO_SEARCH_TOOLS,
 * COMPOSIO_GET_TOOL_SCHEMAS and COMPOSIO_MULTI_EXECUTE_TOOL.
 */

export interface ToolkitOption {
	toolkit: string;
	description: string;
	connected: boolean;
}

export interface ToolOption {
	slug: string;
	description: string;
	toolkit: string;
	requiredFields: string[];
}

export interface ToolParameter {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Depth-first search for the first array of objects that has every named key present. */
function findArrayOfRecords(value: unknown, keys: string[], depth = 0): Record_[] | undefined {
	if (depth > 6) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findArrayOfRecords(item, keys, depth + 1);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (!isRecord(value)) return undefined;

	for (const child of Object.values(value)) {
		if (Array.isArray(child) && child.length > 0 && child.every((item) => isRecord(item) && keys.every((key) => key in item))) {
			return child as Record_[];
		}
	}
	for (const child of Object.values(value)) {
		const found = findArrayOfRecords(child, keys, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** Finds a nested record under the given key, at any depth, so wrapper changes do not break us. */
function findRecordByKey(value: unknown, key: string, depth = 0): Record_ | undefined {
	if (depth > 6 || !isRecord(value)) return undefined;
	const direct = value[key];
	if (isRecord(direct)) return direct;
	for (const child of Object.values(value)) {
		const found = findRecordByKey(child, key, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** Finds the first JSON Schema object in the payload: an object with a `properties` object. */
function findJsonSchema(value: unknown, depth = 0): Record_ | undefined {
	if (depth > 6) return undefined;
	if (isRecord(value)) {
		if (isRecord(value.properties)) return value;
		for (const child of Object.values(value)) {
			const found = findJsonSchema(child, depth + 1);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

function slugToToolkit(slug: string): string {
	const first = slug.split('_')[0];
	return first === undefined ? '' : first.toLowerCase();
}

/**
 * Toolkit slugs with a human description and whether the user already has a working connection.
 * This is what populates the App (Toolkit) picker, and it is the only catalog view the consumer
 * (Connect) surface exposes, since it has no list-toolkits meta-tool.
 */
export function extractToolkits(payload: unknown): ToolkitOption[] {
	const out = new Map<string, ToolkitOption>();

	const statuses = findArrayOfRecords(payload, ['toolkit', 'has_active_connection']);
	for (const entry of statuses ?? []) {
		const toolkit = asString(entry.toolkit);
		if (toolkit === undefined) continue;
		const existing = out.get(toolkit);
		const option: ToolkitOption = {
			toolkit,
			description: asString(entry.description) ?? existing?.description ?? '',
			connected: entry.has_active_connection === true || existing?.connected === true,
		};
		out.set(toolkit, option);
	}

	// Anything seen in the tool list is a toolkit we can offer too, even if its status was absent.
	for (const tool of extractTools(payload)) {
		if (tool.toolkit === '' || out.has(tool.toolkit)) continue;
		out.set(tool.toolkit, { toolkit: tool.toolkit, description: '', connected: false });
	}

	return [...out.values()].sort((a, b) => a.toolkit.localeCompare(b.toolkit));
}

/** Tool slugs with a description and the parameters the tool requires. */
export function extractTools(payload: unknown): ToolOption[] {
	const out = new Map<string, ToolOption>();

	// tool_schemas is an object keyed by tool slug, each holding the tool definition. It sits under
	// the meta-tool envelope in practice, so it is located by key rather than assumed to be top level.
	const schemas = findRecordByKey(payload, 'tool_schemas');
	if (schemas !== undefined) {
		for (const [slug, value] of Object.entries(schemas)) {
			const record = isRecord(value) ? value : {};
			out.set(slug, {
				slug,
				description: asString(record.description) ?? '',
				toolkit: asString(record.toolkit) ?? asString(record.toolkit_slug) ?? slugToToolkit(slug),
				requiredFields: requiredFieldsOf(record.input_schema ?? record.input_parameters),
			});
		}
	}

	// Fall back to the slug lists, which exist even when schemas are withheld.
	const results = findArrayOfRecords(payload, ['primary_tool_slugs', 'related_tool_slugs']);
	for (const entry of results ?? []) {
		for (const key of ['primary_tool_slugs', 'related_tool_slugs'] as const) {
			const slugs = entry[key];
			if (!Array.isArray(slugs)) continue;
			for (const slug of slugs) {
				const name = asString(slug);
				if (name === undefined || out.has(name)) continue;
				out.set(name, { slug: name, description: '', toolkit: slugToToolkit(name), requiredFields: [] });
			}
		}
	}

	return [...out.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function requiredFieldsOf(schema: unknown): string[] {
	if (!isRecord(schema)) return [];
	const required = schema.required;
	return Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * The parameters a tool accepts, from its JSON Schema, so the editor can offer a dropdown of field
 * names instead of asking the user to write JSON.
 */
export function extractParameters(payload: unknown, slug?: string): ToolParameter[] {
	let schema: Record_ | undefined;

	if (slug !== undefined && isRecord(payload)) {
		const direct = payload[slug];
		if (isRecord(direct)) schema = findJsonSchema(direct.input_schema ?? direct);
	}
	if (schema === undefined) schema = findJsonSchema(payload);
	if (schema === undefined) return [];

	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = requiredFieldsOf(schema);

	return Object.entries(properties)
		.map(([name, value]) => {
			const record = isRecord(value) ? value : {};
			const type =
				asString(record.type) ??
				(Array.isArray(record.anyOf) ? 'any' : undefined) ??
				(isRecord(record.items) ? 'array' : undefined) ??
				'string';
			return {
				name,
				type,
				required: required.includes(name),
				description: asString(record.description) ?? '',
			};
		})
		.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
}

/**
 * Turns one "Parameter"/"Value" row from the editor into a real argument. Values arrive as text
 * from the UI, so anything that looks like JSON is parsed, and everything else stays a string.
 *
 * Numbers are only converted when the conversion round-trips exactly, so identifiers keep their
 * leading zeros: a phone number entered as 0244123456 stays a string, while 42 becomes a number.
 */
export function coerceParameterValue(raw: unknown): unknown {
	if (typeof raw !== 'string') return raw;
	const trimmed = raw.trim();
	if (trimmed === '') return '';
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	if (trimmed === 'null') return null;
	if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed) && String(Number(trimmed)) === trimmed) {
		return Number(trimmed);
	}
	if (
		(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
		(trimmed.startsWith('[') && trimmed.endsWith(']')) ||
		(trimmed.startsWith('"') && trimmed.endsWith('"'))
	) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return raw;
		}
	}
	return raw;
}

/** Builds the tool arguments from the editor rows, dropping empty names. */
export function buildArgumentsFromRows(
	rows: Array<{ name?: unknown; value?: unknown }> | undefined,
): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const row of rows ?? []) {
		const name = asString(row.name);
		if (name === undefined) continue;
		args[name] = coerceParameterValue(row.value);
	}
	return args;
}
