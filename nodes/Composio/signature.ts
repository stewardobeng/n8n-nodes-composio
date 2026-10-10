import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Composio signs every webhook request with three headers: webhook-id, webhook-timestamp and
 * webhook-signature. The signature is HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{rawBody}`,
 * base64 encoded, and the header may carry a scheme prefix such as `v1,`.
 *
 * Rejecting stale timestamps blocks replays, which matters because a captured payload stays valid
 * forever otherwise. Composio's own SDKs use a 300 second tolerance.
 */
export interface SignatureCheckInput {
	secret: string;
	rawBody: string;
	signature?: string;
	id?: string;
	timestamp?: string;
	toleranceSeconds?: number;
}

export type SignatureCheckResult = { ok: true } | { ok: false; reason: string };

export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Composio sends seconds, but a millisecond value is accepted rather than rejected outright. */
function toMilliseconds(timestamp: string): number | undefined {
	const value = Number(timestamp);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return value > 1e11 ? value : value * 1000;
}

/** The header is `v1,<base64>` in the SDK examples, so a scheme prefix is stripped if present. */
function stripScheme(signature: string): string {
	const comma = signature.indexOf(',');
	return comma === -1 ? signature : signature.slice(comma + 1);
}

export function checkSignature(
	input: SignatureCheckInput,
	now: number = Date.now(),
): SignatureCheckResult {
	const { secret, rawBody, signature, id, timestamp } = input;
	const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

	if (secret === '') return { ok: false, reason: 'no webhook signing secret is configured' };
	if (id === undefined || id === '') return { ok: false, reason: 'the webhook-id header is missing' };
	if (timestamp === undefined || timestamp === '') {
		return { ok: false, reason: 'the webhook-timestamp header is missing' };
	}
	if (signature === undefined || signature === '') {
		return { ok: false, reason: 'the webhook-signature header is missing' };
	}

	const received = stripScheme(signature);
	const expected = createHmac('sha256', secret)
		.update(`${id}.${timestamp}.${rawBody}`)
		.digest('base64');

	const receivedBuffer = Buffer.from(received, 'utf8');
	const expectedBuffer = Buffer.from(expected, 'utf8');
	if (receivedBuffer.length !== expectedBuffer.length) {
		return { ok: false, reason: 'the signature does not match the request body' };
	}
	if (!timingSafeEqual(receivedBuffer, expectedBuffer)) {
		return { ok: false, reason: 'the signature does not match the request body' };
	}

	const sentAt = toMilliseconds(timestamp);
	if (sentAt === undefined) return { ok: false, reason: 'the webhook-timestamp header is not a number' };
	const ageSeconds = Math.abs(now - sentAt) / 1000;
	if (ageSeconds > toleranceSeconds) {
		return {
			ok: false,
			reason: `the request is ${Math.round(ageSeconds)} seconds old, beyond the ${toleranceSeconds} second tolerance`,
		};
	}

	return { ok: true };
}
