import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildToolArguments, callMetaTool, parseMcpPayload } from '../dist/nodes/Composio/GenericFunctions.js';
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
function fakeContext(responder) {
	const calls = [];
	const ctx = {
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
	assert.equal(calls[0].options.url, '/mcp');
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
