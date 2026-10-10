import type { IExecuteFunctions, IHttpRequestOptions, ILoadOptionsFunctions } from 'n8n-workflow';

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

async function mcpRequest(
	ctx: ComposioContext,
	method: string,
	params: Record<string, unknown>,
): Promise<JsonRpcEnvelope> {
	const id = nextRequestId++;
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: '/mcp',
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

	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'composioApi',
		options,
	)) as RawHttpResponse;

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
		clientInfo: { name: 'n8n-nodes-composio', version: '0.1.0' },
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
