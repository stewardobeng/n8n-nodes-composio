import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildToolArguments, buildMcpUrl, callMetaTool, parseMcpPayload } from '../dist/nodes/Composio/GenericFunctions.js';
import { META_TOOLS } from '../dist/nodes/Composio/metatools.js';

const sse = (...frames) => frames.map((f) => `event: message\ndata: ${JSON.stringify(f)}\n\n`).join('');

test('a JSON body is returned as the JSON-RPC envelope', () => {
	const envelope = parseMcpPayload({ jsonrpc: '2.0', id: 4, result: { ok: true } }, 4);
	assert.deepEqual(envelope.result, { ok: true });
});

test('an event stream is unwrapped to the frame matching the request id', () => {
	const body = sse(
		{ jsonrpc: '2.0', id: 99, result: { stale: true } },
		{ jsonrpc: '2.0', id: 7, result: { fresh: true } },
	);
	assert.deepEqual(parseMcpPayload(body, 7).result, { fresh: true });
});

test('an event stream with no matching id falls back instead of returning nothing', () => {
	const body = sse({ jsonrpc: '2.0', id: 1, result: { only: true } });
	assert.deepEqual(parseMcpPayload(body, 42).result, { only: true });
});

test('JSON-RPC errors survive parsing', () => {
	const envelope = parseMcpPayload(
		{ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } },
		1,
	);
	assert.equal(envelope.error.message, 'Invalid params');
});

test('an unreadable body raises a clear error rather than a silent empty result', () => {
	assert.throws(() => parseMcpPayload('', 1), /empty response/);
	assert.throws(() => parseMcpPayload('event: message\ndata: not json\n\n', 1), /could not be read/);
});

test('empty values are dropped from tool arguments', () => {
	assert.deepEqual(
		buildToolArguments({ action: 'create', toolkit: 'gmail', user_id: undefined, note: '' }),
		{ action: 'create', toolkit: 'gmail' },
	);
});

/** A stand-in for the n8n execution context, so the real transport code is exercised. */
function fakeContext(responder, credentialOverrides = {}) {
	const calls = [];
	const credentials = {
		apiKey: 'ck_test_key',
		baseUrl: 'https://connect.composio.dev',
		userId: '',
		...credentialOverrides,
	};
	const ctx = {
		getCredentials: async () => credentials,
		getNode: () => ({
			name: 'Composio Connect',
			type: '@steprotech/n8n-nodes-composio.composio',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		helpers: {
			httpRequestWithAuthentication: {
				async call(_ctx, credentialType, options) {
					calls.push({ credentialType, options });
					return responder(options, calls.length);
				},
			},
		},
	};
	return { ctx, calls };
}

test('a meta-tool call initializes a session, reuses its id, and parses the answer', async () => {
	const { ctx, calls } = fakeContext((options) => {
		if (options.body.method === 'initialize') {
			return {
				statusCode: 200,
				headers: { 'mcp-session-id': 'sess-123' },
				body: JSON.stringify({ jsonrpc: '2.0', id: options.body.id, result: { protocolVersion: '2025-06-18' } }),
			};
		}
		if (options.body.method === 'notifications/initialized') {
			return { statusCode: 202, headers: {}, body: '' };
		}
		return {
			statusCode: 200,
			headers: {},
			body: {
				jsonrpc: '2.0',
				id: options.body.id,
				result: {
					content: [{ type: 'text', text: JSON.stringify({ tools: [{ slug: 'GMAIL_SEND_EMAIL' }] }) }],
				},
			},
		};
	});

	const outcome = await callMetaTool(ctx, META_TOOLS.searchTools, { query: 'send email' });

	assert.equal(calls[0].options.body.method, 'initialize');
	assert.equal(calls[0].credentialType, 'composioApi');
	assert.equal(calls[0].options.url, 'https://connect.composio.dev/mcp');
	assert.equal(calls[0].options.headers['x-consumer-api-key'], undefined, 'the key comes from the credential, never from code');
	assert.equal(calls[1].options.headers['mcp-session-id'], 'sess-123');
	assert.equal(calls[2].options.body.method, 'tools/call');
	assert.equal(calls[2].options.body.params.name, META_TOOLS.searchTools);
	assert.deepEqual(calls[2].options.body.params.arguments, { query: 'send email' });
	assert.deepEqual(outcome.data, { tools: [{ slug: 'GMAIL_SEND_EMAIL' }] });
	assert.equal(outcome.isError, false);
});

test('a failing meta-tool surfaces the Composio message', async () => {
	const { ctx } = fakeContext((options) => {
		if (options.body.method === 'initialize') {
			return { statusCode: 200, headers: {}, body: { jsonrpc: '2.0', id: options.body.id, result: {} } };
		}
		if (options.body.method === 'notifications/initialized') {
			return { statusCode: 202, headers: {}, body: '' };
		}
		return {
			statusCode: 200,
			headers: {},
			body: { jsonrpc: '2.0', id: options.body.id, error: { code: -32000, message: 'toolkit not connected' } },
		};
	});

	await assert.rejects(() => callMetaTool(ctx, META_TOOLS.multiExecuteTool, {}), /toolkit not connected/);
});

test('an MCP error during initialize is reported, not swallowed', async () => {
	const { ctx } = fakeContext(() => ({
		statusCode: 200,
		headers: {},
		body: { jsonrpc: '2.0', id: 1, error: { message: 'invalid consumer key' } },
	}));

	await assert.rejects(() => callMetaTool(ctx, META_TOOLS.searchTools, {}), /invalid consumer key/);
});

test('the MCP url is absolute, because n8n does not prefix a credential base URL for real requests', () => {
	assert.equal(buildMcpUrl(undefined), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl(''), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl('   '), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl('https://connect.composio.dev'), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl('https://connect.composio.dev/'), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl('https://connect.composio.dev///'), 'https://connect.composio.dev/mcp');
	assert.equal(buildMcpUrl('https://self.hosted.example/base'), 'https://self.hosted.example/base/mcp');
});

test('a custom base URL from the credential is used, and never a relative path', async () => {
	const { ctx, calls } = fakeContext(
		(options) => ({
			statusCode: 200,
			headers: {},
			body: { jsonrpc: '2.0', id: options.body.id, result: {} },
		}),
		{ baseUrl: 'https://self.hosted.example/' },
	);
	await callMetaTool(ctx, META_TOOLS.searchTools, {});
	assert.equal(calls[0].options.url, 'https://self.hosted.example/mcp');
	assert.match(calls[0].options.url, /^https:\/\//, 'a relative url fails before it leaves n8n');
});

test('a missing credential is explained instead of failing obscurely', async () => {
	const ctx = {
		getNode: () => ({
			name: 'Composio Connect',
			type: '@steprotech/n8n-nodes-composio.composio',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getCredentials: async () => {
			throw new Error('Credentials not found');
		},
		helpers: { httpRequestWithAuthentication: { async call() { throw new Error('unreachable'); } } },
	};

	await assert.rejects(
		() => callMetaTool(ctx, META_TOOLS.searchTools, {}),
		/Select a Composio API credential on this node first/,
	);
});

test('a rejected key reports a credential problem, not a URL or a vague failure', async () => {
	const { ctx } = fakeContext(() => {
		const error = new Error('unauthorized');
		error.statusCode = 401;
		throw error;
	});

	await assert.rejects(
		() => callMetaTool(ctx, META_TOOLS.searchTools, {}),
		/Composio rejected the credential \(HTTP 401\)/,
	);
});

test('a 404 points at the base URL, since that is the usual cause', async () => {
	const { ctx } = fakeContext(() => {
		const error = new Error('not found');
		error.httpCode = '404';
		throw error;
	});

	await assert.rejects(
		() => callMetaTool(ctx, META_TOOLS.searchTools, {}),
		/Composio answered 404 for https:\/\/connect\.composio\.dev\/mcp/,
	);
});

test('a network failure keeps the original reason visible', async () => {
	const { ctx } = fakeContext(() => {
		throw new Error('getaddrinfo ENOTFOUND connect.composio.dev');
	});

	await assert.rejects(
		() => callMetaTool(ctx, META_TOOLS.searchTools, {}),
		(error) => {
			assert.equal(error.name, 'NodeOperationError');
			assert.match(error.message, /The request to Composio failed/);
			// n8n rewrites the message for network errors, so the real reason rides in the description
			// together with the URL we actually called, which is what makes this diagnosable.
			assert.match(error.description, /getaddrinfo ENOTFOUND/);
			assert.match(error.description, /https:\/\/connect\.composio\.dev\/mcp/);
			return true;
		},
	);
});
