import type { IExecuteFunctions, IHttpRequestOptions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { META_TOOLS } from './metatools';

type ComposioContext = IExecuteFunctions | ILoadOptionsFunctions;

interface JsonRpcError {
	code?: number;
	message?: string;
	data?: unknown;
}

interface JsonRpcEnvelope {
	result?: unknown;
	error?: JsonRpcError;
}

interface RawHttpResponse {
	statusCode?: number;
	headers?: Record<string, string | string[] | undefined>;
	body?: unknown;
}

/** Session IDs are per execution, so they are cached against the context object. */
const sessionCache = new WeakMap<object, string>();

let nextRequestId = 1;

export function buildToolArguments(pairs: Record<string, unknown>): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(pairs)) {
		if (value === undefined || value === null || value === '') continue;
		args[key] = value;
	}
	return args;
}

/**
 * MCP over streamable HTTP answers either as JSON or as a server-sent event stream.
 * Both shapes are unwrapped here so the rest of the node only sees JSON-RPC results.
 */
export function parseMcpPayload(body: unknown, expectedId: number): JsonRpcEnvelope {
	if (typeof body === 'string') {
		const trimmed = body.trim();
		if (trimmed === '') {
			throw new Error('Composio returned an empty response');
		}

		// n8n hands back the body as text unless the response is JSON typed, so try plain JSON first.
		if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed) as JsonRpcEnvelope;
				if (parsed !== null && typeof parsed === 'object') return parsed;
			} catch {
				// fall through to event-stream parsing
			}
		}

		const events = trimmed.split(/\r?\n\r?\n/);
		let fallback: JsonRpcEnvelope | undefined;
		for (const event of events) {
			const dataLines = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trim());
			if (dataLines.length === 0) continue;
			try {
				const parsed = JSON.parse(dataLines.join('\n')) as JsonRpcEnvelope & { id?: number };
				if (parsed.id === expectedId) return parsed;
				if (fallback === undefined) fallback = parsed;
			} catch {
				continue;
			}
		}
		if (fallback !== undefined) return fallback;
		throw new Error('Composio returned an event stream that could not be read as JSON-RPC');
	}

	if (body !== null && typeof body === 'object') return body as JsonRpcEnvelope;
	throw new Error('Composio returned an empty response');
}

export const DEFAULT_BASE_URL = 'https://connect.composio.dev';

/**
 * The MCP endpoint is an absolute URL. n8n only applies a credential's base URL to a credential
 * test, so real requests have to build the full address themselves; a relative url fails before it
 * ever leaves n8n.
 */
export function buildMcpUrl(baseUrl?: string): string {
	const trimmed = (baseUrl ?? '').trim();
	const base = trimmed === '' ? DEFAULT_BASE_URL : trimmed;
	return `${base.replace(/\/+$/, '')}/mcp`;
}

async function mcpRequest(
	ctx: ComposioContext,
	method: string,
	params: Record<string, unknown>,
): Promise<JsonRpcEnvelope> {
	const id = nextRequestId++;

	let credentials;
	try {
		credentials = await ctx.getCredentials('composioApi');
	} catch (error) {
		throw new NodeOperationError(
			ctx.getNode(),
			`Select a Composio API credential on this node first. (${(error as Error).message})`,
		);
	}

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: buildMcpUrl(credentials.baseUrl as string | undefined),
		headers: {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
		},
		body: {
			jsonrpc: '2.0',
			id,
			method,
			params,
		},
		json: true,
		returnFullResponse: true,
	};

	const cachedSession = sessionCache.get(ctx);
	if (cachedSession !== undefined) {
		(options.headers as Record<string, string>)['mcp-session-id'] = cachedSession;
	}

	let response: RawHttpResponse;
	try {
		response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			'composioApi',
			options,
		)) as RawHttpResponse;
	} catch (error) {
		const failure = error as { httpCode?: string; statusCode?: number; response?: { status?: number } };
		const status = failure.statusCode ?? failure.response?.status ?? failure.httpCode;
		const statusLabel = status === undefined ? '' : String(status);
		if (statusLabel === '401' || statusLabel === '403') {
			throw new NodeOperationError(
				ctx.getNode(),
				`Composio rejected the credential (HTTP ${statusLabel}). Check that the consumer key is current and belongs to the workspace you expect.`,
			);
		}
		if (statusLabel === '404') {
			throw new NodeOperationError(
				ctx.getNode(),
				`Composio answered 404 for ${options.url}. Check the base URL in the credential, which should normally be ${DEFAULT_BASE_URL}.`,
			);
		}
		throw new NodeOperationError(ctx.getNode(), 'The request to Composio failed', {
			description: `${statusLabel === '' ? '' : `HTTP ${statusLabel}. `}${(error as Error).message} (${options.url})`,
		});
	}

	const sessionHeader = response.headers?.['mcp-session-id'];
	const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
	if (typeof sessionId === 'string' && sessionId !== '') {
		sessionCache.set(ctx, sessionId);
	}

	// Notifications are one way: the server acknowledges with 202 and no body.
	const body = response.body;
	if (method.startsWith('notifications/') && (body === '' || body === null || body === undefined)) {
		return {};
	}

	return parseMcpPayload(body, id);
}

async function ensureSession(ctx: ComposioContext): Promise<void> {
	if (sessionCache.has(ctx)) return;
	const envelope = await mcpRequest(ctx, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'n8n-nodes-composio', version: '0.2.1' },
	});
	if (envelope.error !== undefined) {
		throw new Error(
			`Composio refused the MCP session: ${envelope.error.message ?? 'unknown error'}`,
		);
	}
	await mcpRequest(ctx, 'notifications/initialized', {});
}

export interface MetaToolOutcome {
	tool: string;
	text: string;
	data: unknown;
	isError: boolean;
}

/**
 * Searches the Composio catalog. Argument shape per Composio's COMPOSIO_SEARCH_TOOLS documentation:
 * `queries` is a list of structured use cases, and `session` correlates related calls.
 * `search_strategy: 'tool_search'` skips cached plans, which is what a picker wants: matching tools
 * rather than a workflow plan.
 */
export async function searchCatalog(ctx: ComposioContext, useCase: string): Promise<unknown> {
	const outcome = await callMetaTool(ctx, META_TOOLS.searchTools, {
		queries: [{ use_case: useCase }],
		session: { generate_id: true },
		search_strategy: 'tool_search',
	});
	return outcome.data;
}

/** Fetches the input schema for tool slugs the search already returned. */
export async function fetchToolSchemas(ctx: ComposioContext, toolSlugs: string[]): Promise<unknown> {
	const outcome = await callMetaTool(ctx, META_TOOLS.getToolSchemas, {
		tool_slugs: toolSlugs,
		include: ['input_schema'],
	});
	return outcome.data;
}

/**
 * Starts or reports connections. Composio's COMPOSIO_MANAGE_CONNECTIONS takes toolkit slugs and opens
 * an auth flow for any that are missing, so this both checks and connects.
 */
export async function manageConnections(
	ctx: ComposioContext,
	toolkits: string[],
	reinitiateAll = false,
): Promise<MetaToolOutcome> {
	const args: Record<string, unknown> = { toolkits };
	if (reinitiateAll) args.reinitiate_all = true;
	return await callMetaTool(ctx, META_TOOLS.manageConnections, args);
}

/**
 * Calls one Composio meta-tool and returns both the raw text and, when the tool
 * answered with JSON, the parsed data.
 */
export async function callMetaTool(
	ctx: ComposioContext,
	tool: string,
	args: Record<string, unknown>,
): Promise<MetaToolOutcome> {
	await ensureSession(ctx);

	const envelope = await mcpRequest(ctx, 'tools/call', { name: tool, arguments: args });

	if (envelope.error !== undefined) {
		throw new Error(
			`Composio meta-tool ${tool} failed: ${envelope.error.message ?? 'unknown error'}`,
		);
	}

	const result = (envelope.result ?? {}) as {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
		structuredContent?: unknown;
	};

	const text = (result.content ?? [])
		.filter((part) => typeof part.text === 'string')
		.map((part) => part.text as string)
		.join('\n')
		.trim();

	let data: unknown = result.structuredContent;
	if (data === undefined && text !== '') {
		try {
			data = JSON.parse(text);
		} catch {
			data = undefined;
		}
	}

	return {
		tool,
		text,
		data: data === undefined ? text : data,
		isError: result.isError === true,
	};
}
