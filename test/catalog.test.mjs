import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	buildArgumentsFromRows,
	coerceParameterValue,
	extractParameters,
	extractToolkits,
	extractTools,
} from '../dist/nodes/Composio/catalog.js';

/**
 * Fixtures follow Composio's documented COMPOSIO_SEARCH_TOOLS response: per-query results with slug
 * lists, a tool_schemas map keyed by slug, and toolkit_connection_statuses. The node wraps these in
 * the meta-tool envelope, so the payload here is nested one level deeper on purpose.
 */
const searchEnvelope = {
	successful: true,
	data: {
		results: [
			{
				index: 1,
				use_case: 'send an email',
				primary_tool_slugs: ['GMAIL_SEND_EMAIL'],
				related_tool_slugs: ['GMAIL_FETCH_EMAILS'],
				toolkits: ['gmail'],
				reasoning: 'direct match',
			},
		],
		tool_schemas: {
			GMAIL_SEND_EMAIL: {
				description: 'Send an email through Gmail',
				toolkit: 'gmail',
				input_schema: {
					type: 'object',
					properties: {
						recipient_email: { type: 'string', description: 'To address' },
						subject: { type: 'string', description: 'Subject line' },
						body: { type: 'string', description: 'Message body' },
						is_html: { type: 'boolean', description: 'Send as HTML' },
					},
					required: ['recipient_email', 'body'],
				},
			},
			GMAIL_FETCH_EMAILS: {
				description: 'List Gmail messages',
				toolkit: 'gmail',
				input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: [] },
			},
		},
		toolkit_connection_statuses: [
			{
				toolkit: 'gmail',
				description: 'Gmail email',
				has_active_connection: true,
				connection_details: {},
				status_message: 'connected',
			},
			{
				toolkit: 'github',
				description: 'GitHub repositories',
				has_active_connection: false,
				connection_details: {},
				status_message: 'connect first',
			},
		],
	},
};

test('toolkits are read with their connection status, from wherever they sit in the payload', () => {
	const toolkits = extractToolkits(searchEnvelope);
	assert.deepEqual(toolkits.map((t) => t.toolkit), ['github', 'gmail']);
	assert.equal(toolkits.find((t) => t.toolkit === 'gmail').connected, true);
	assert.equal(toolkits.find((t) => t.toolkit === 'github').connected, false);
	assert.equal(toolkits.find((t) => t.toolkit === 'github').description, 'GitHub repositories');
});

test('tools are read from the schema map and from the slug lists, without duplicates', () => {
	const tools = extractTools(searchEnvelope);
	assert.deepEqual(tools.map((t) => t.slug), ['GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL']);
	const send = tools.find((t) => t.slug === 'GMAIL_SEND_EMAIL');
	assert.equal(send.description, 'Send an email through Gmail');
	assert.equal(send.toolkit, 'gmail');
	assert.deepEqual(send.requiredFields, ['recipient_email', 'body']);
});

test('a slug-only answer still yields selectable actions with a derived toolkit', () => {
	const tools = extractTools({
		data: { results: [{ primary_tool_slugs: ['SLACK_SEND_MESSAGE'], related_tool_slugs: [] }] },
	});
	assert.deepEqual(tools, [
		{ slug: 'SLACK_SEND_MESSAGE', description: '', toolkit: 'slack', requiredFields: [] },
	]);
});

test('tool parameters come from the action schema, required ones first', () => {
	const parameters = extractParameters(searchEnvelope, 'GMAIL_SEND_EMAIL');
	assert.deepEqual(parameters.map((p) => p.name), ['body', 'recipient_email', 'is_html', 'subject']);
	assert.deepEqual(parameters.filter((p) => p.required).map((p) => p.name), ['body', 'recipient_email']);
	assert.equal(parameters.find((p) => p.name === 'is_html').type, 'boolean');
	assert.equal(parameters.find((p) => p.name === 'subject').description, 'Subject line');
});

test('a schema fetched on its own is found even when the response shape differs', () => {
	const standalone = {
		successful: true,
		data: {
			GMAIL_SEND_EMAIL: {
				input_schema: {
					type: 'object',
					properties: { to: { type: 'string' } },
					required: ['to'],
				},
			},
		},
	};
	const parameters = extractParameters(standalone, 'GMAIL_SEND_EMAIL');
	assert.deepEqual(parameters.map((p) => p.name), ['to']);
	assert.equal(parameters[0].required, true);
});

test('a payload with no schema yields no parameters rather than throwing', () => {
	assert.deepEqual(extractParameters({ data: { nothing: true } }, 'X'), []);
	assert.deepEqual(extractParameters(null), []);
	assert.deepEqual(extractToolkits(undefined), []);
	assert.deepEqual(extractTools('not an object'), []);
});

test('typed values are converted when they round-trip, and identifiers keep their leading zeros', () => {
	assert.equal(coerceParameterValue('42'), 42);
	assert.equal(coerceParameterValue('3.5'), 3.5);
	assert.equal(coerceParameterValue('0'), 0);
	assert.equal(coerceParameterValue('-7'), -7);
	assert.equal(coerceParameterValue('true'), true);
	assert.equal(coerceParameterValue('false'), false);
	assert.equal(coerceParameterValue('null'), null);
	assert.deepEqual(coerceParameterValue('{"a":1}'), { a: 1 });
	assert.deepEqual(coerceParameterValue('[1,2]'), [1, 2]);
	assert.equal(coerceParameterValue('hello world'), 'hello world');
	// The ones that must not be mangled.
	assert.equal(coerceParameterValue('0244123456'), '0244123456');
	assert.equal(coerceParameterValue('3.50'), '3.50');
	assert.equal(coerceParameterValue('+233244123456'), '+233244123456');
	assert.equal(coerceParameterValue(''), '');
});

test('editor rows become the arguments object, ignoring unnamed rows', () => {
	assert.deepEqual(
		buildArgumentsFromRows([
			{ name: 'recipient_email', value: 'a@b.com' },
			{ name: 'is_html', value: 'true' },
			{ name: 'count', value: '3' },
			{ name: '', value: 'ignored' },
			{ value: 'no name' },
		]),
		{ recipient_email: 'a@b.com', is_html: true, count: 3 },
	);

	assert.deepEqual(buildArgumentsFromRows(undefined), {});
});
