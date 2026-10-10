import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { checkSignature, DEFAULT_TOLERANCE_SECONDS } from '../dist/nodes/Composio/signature.js';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({
	type: 'composio.trigger.message',
	metadata: { trigger_slug: 'GITHUB_COMMIT_EVENT' },
	data: { message: 'ship it' },
});

/** Signs exactly the way Composio documents it: base64 HMAC-SHA256 over id.timestamp.body. */
function sign(id, timestamp, body = BODY, secret = SECRET) {
	return createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64');
}

const NOW = 1_700_000_000_000;
const STAMP = String(Math.floor(NOW / 1000));

function valid(overrides = {}) {
	return {
		secret: SECRET,
		rawBody: BODY,
		id: 'msg_1',
		timestamp: STAMP,
		signature: sign('msg_1', STAMP),
		...overrides,
	};
}

test('a correctly signed request is accepted', () => {
	assert.deepEqual(checkSignature(valid(), NOW), { ok: true });
});

test('a signature with the v1 scheme prefix is accepted', () => {
	assert.deepEqual(checkSignature(valid({ signature: `v1,${sign('msg_1', STAMP)}` }), NOW), { ok: true });
});

test('a millisecond timestamp is accepted, not rejected as ancient', () => {
	const milliseconds = String(NOW);
	assert.deepEqual(
		checkSignature(valid({ timestamp: milliseconds, signature: sign('msg_1', milliseconds) }), NOW),
		{ ok: true },
	);
});

test('a tampered body is rejected', () => {
	assert.deepEqual(checkSignature(valid({ rawBody: BODY + ' ' }), NOW), {
		ok: false,
		reason: 'the signature does not match the request body',
	});
});

test('a wrong secret is rejected, so the URL alone is not enough to inject events', () => {
	assert.deepEqual(checkSignature(valid({ secret: 'the wrong one' }), NOW), {
		ok: false,
		reason: 'the signature does not match the request body',
	});
});

test('replaying an old payload is rejected', () => {
	const old = String(Math.floor(NOW / 1000) - DEFAULT_TOLERANCE_SECONDS - 60);
	const result = checkSignature(valid({ timestamp: old, signature: sign('msg_1', old) }), NOW);
	assert.equal(result.ok, false);
	assert.match(result.ok === false ? result.reason : '', /beyond the 300 second tolerance/);
});

test('a signature from the future beyond tolerance is rejected too', () => {
	const ahead = String(Math.floor(NOW / 1000) + DEFAULT_TOLERANCE_SECONDS + 60);
	const result = checkSignature(valid({ timestamp: ahead, signature: sign('msg_1', ahead) }), NOW);
	assert.equal(result.ok, false);
});

test('a missing secret, id, timestamp or signature is refused with a reason, never silently accepted', () => {
	const cases = [
		[{ secret: '' }, /no webhook signing secret/],
		[{ id: undefined }, /webhook-id header is missing/],
		[{ timestamp: undefined }, /webhook-timestamp header is missing/],
		[{ signature: undefined }, /webhook-signature header is missing/],
		[
			// The signature is verified before the timestamp is parsed, so this case has to be signed
			// correctly over its own bad timestamp to reach the parse check at all.
			{ timestamp: 'not-a-number', signature: sign('msg_1', 'not-a-number') },
			/webhook-timestamp header is not a number/,
		],
	];
	for (const [override, pattern] of cases) {
		const result = checkSignature(valid(override), NOW);
		assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(override)}`);
		assert.match(result.ok === false ? result.reason : '', pattern);
	}
});

test('a signature of a different length is refused without throwing', () => {
	assert.deepEqual(checkSignature(valid({ signature: 'short' }), NOW), {
		ok: false,
		reason: 'the signature does not match the request body',
	});
});
