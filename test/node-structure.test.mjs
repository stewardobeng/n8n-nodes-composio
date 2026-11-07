import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Composio } from '../dist/nodes/Composio/Composio.node.js';
import { ComposioTrigger } from '../dist/nodes/Composio/ComposioTrigger.node.js';
import { ComposioApi } from '../dist/credentials/ComposioApi.credentials.js';
import { META_TOOLS, META_TOOL_OPTIONS } from '../dist/nodes/Composio/metatools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const description = new Composio().description;
const trigger = new ComposioTrigger().description;
const credential = new ComposioApi();

const DOCUMENTED_META_TOOLS = [
	'COMPOSIO_SEARCH_TOOLS',
	'COMPOSIO_GET_TOOL_SCHEMAS',
	'COMPOSIO_MULTI_EXECUTE_TOOL',
	'COMPOSIO_MANAGE_CONNECTIONS',
	'COMPOSIO_WAIT_FOR_CONNECTIONS',
	'COMPOSIO_BASH_TOOL',
];

test('the node registers the resources and operations Composio Connect needs', () => {
	const resources = description.properties.find((p) => p.name === 'resource').options.map((o) => o.value);
	assert.deepEqual(resources.sort(), ['action', 'advanced', 'connection']);

	const operationsFor = (resource) =>
		description.properties
			.filter((p) => p.name === 'operation')
			.find((p) => p.displayOptions.show.resource.includes(resource))
			.options.map((o) => o.value)
			.sort();

	assert.deepEqual(operationsFor('connection'), ['check', 'connect', 'reconnect']);
	assert.deepEqual(operationsFor('action'), ['execute', 'schemas', 'search']);
	assert.deepEqual(operationsFor('advanced'), ['call']);
});

test('the node can be used as an AI agent tool', () => {
	assert.equal(description.usableAsTool, true);
});

test('every operation is labelled and described, and every parameter documents itself', () => {
	for (const property of description.properties) {
		if (property.name === 'resource' || property.name === 'operation') {
			for (const option of property.options) {
				assert.ok(option.description, `${property.name} option ${option.value} needs a description`);
			}
			continue;
		}
		assert.ok(property.description, `parameter ${property.name} needs a description`);
		assert.ok(property.displayName, `parameter ${property.name} needs a display name`);
	}
});

test('the meta-tool names still match the seven Composio documents', () => {
	const names = Object.values(META_TOOLS);
	assert.equal(names.length, 7);
	for (const documented of DOCUMENTED_META_TOOLS) {
		if (documented === 'COMPOSIO_BASH_TOOL') continue;
		assert.ok(names.includes(documented), `${documented} is missing from META_TOOLS`);
	}
	assert.equal(META_TOOL_OPTIONS.length, 7);
});

test('the credential authenticates with the consumer key header, never a project key', () => {
	assert.equal(credential.authenticate.properties.headers['x-consumer-api-key'], '={{$credentials.apiKey}}');
	assert.equal(credential.authenticate.properties.headers['x-api-key'], undefined);
	assert.ok(credential.properties.some((p) => p.name === 'apiKey' && p.typeOptions?.password));
	assert.ok(credential.test.request.url.endsWith('/mcp'));
});

test('every referenced icon exists as a square SVG, in both themes', () => {
	const iconRefs = [];
	const collect = (icon, base) => {
		if (typeof icon === 'string') iconRefs.push([icon, base]);
		else for (const variant of Object.values(icon)) iconRefs.push([variant, base]);
	};

	collect(description.icon, 'nodes/Composio');
	collect(trigger.icon, 'nodes/ComposioTrigger');
	collect(credential.icon, 'credentials');

	assert.equal(
		iconRefs.length,
		6,
		'expected light and dark icons for the node, the trigger and the credential',
	);

	for (const [ref, base] of iconRefs) {
		const file = join(root, base, ref.replace('file:', ''));
		assert.ok(existsSync(file), `${file} is referenced but not shipped`);
		const svg = readFileSync(file, 'utf8');
		assert.match(svg, /<svg/, `${file} is not an SVG`);
		const viewBox = svg.match(/viewBox="([\d.\s-]+)"/);
		assert.ok(viewBox, `${file} has no viewBox`);
		const [, , width, height] = viewBox[1].trim().split(/\s+/).map(Number);
		assert.equal(width, height, `${file} is not square`);
	}
});

test('the dark icon is visible on n8n dark tiles, not black on black', () => {
	const light = readFileSync(join(root, 'nodes/Composio/composio.svg'), 'utf8');
	const dark = readFileSync(join(root, 'nodes/Composio/composio.dark.svg'), 'utf8');
	assert.match(light, /#000000/i);
	assert.doesNotMatch(dark, /#000000/i);
	assert.match(dark, /#FFFFFF/i);
});

test('display names are unique, because n8n keys its installed_nodes table on them', () => {
	// n8n inserts one row per node with `name` set to the node's displayName, and that column is
	// the primary key. A duplicate display name, in this package or against anything else already
	// installed, makes installation fail with SQLITE_CONSTRAINT / duplicate key on installed_nodes.
	const own = [
		description.displayName,
		`${description.displayName} Tool`,
		trigger.displayName,
	];
	assert.equal(new Set(own).size, own.length, 'the node, its tool variant and the trigger must not share a display name');

	// The third-party n8n-nodes-composio package already occupies these, and its webhook path is the
	// bare word too, so a clash would break both packages on one instance.
	for (const taken of ['Composio', 'Composio Tool', 'Composio Trigger']) {
		assert.notEqual(description.displayName, taken, `"${taken}" is already used by n8n-nodes-composio`);
		assert.notEqual(trigger.displayName, taken, `"${taken}" is already used by n8n-nodes-composio`);
	}
	assert.notEqual(trigger.webhooks[0].path, 'composio', 'that webhook path belongs to n8n-nodes-composio');
});

test('the trigger receives what Composio sends, and verifies it by default', () => {
	assert.deepEqual(trigger.group, ['trigger']);
	assert.equal(trigger.webhooks[0].httpMethod, 'POST');
	assert.equal(trigger.webhooks[0].path, 'composio-connect');
	assert.equal(trigger.webhooks[0].responseMode, 'onReceived');

	const verify = trigger.properties.find((p) => p.name === 'verifySignature');
	assert.equal(verify.type, 'boolean');
	assert.equal(verify.default, true, 'unverified events must be opt-in, never the default');

	const events = trigger.properties.find((p) => p.name === 'events');
	assert.ok(events.required, 'the trigger must say which events it reacts to');
	assert.ok(events.options.some((o) => o.value === '*'));

	for (const property of trigger.properties) {
		assert.ok(property.description, `trigger parameter ${property.name} needs a description`);
	}
});

test('the credential can hold the webhook signing secret the trigger verifies against', () => {
	const secret = credential.properties.find((p) => p.name === 'webhookSecret');
	assert.ok(secret, 'the credential needs a webhook signing secret field');
	assert.equal(secret.typeOptions.password, true, 'the secret must be masked in the UI');
});

test('the everyday fields are pickers, so nobody has to know a slug or write JSON', () => {
	const node = new Composio();
	const byName = (name) => description.properties.find((p) => p.name === name);

	// App and Action are dropdowns fed live from Composio, not free-text slug boxes.
	for (const name of ['toolkit', 'toolkits', 'toolSlug', 'toolSlugs']) {
		const property = byName(name);
		assert.ok(property, `${name} must exist`);
		assert.equal(
			property.typeOptions?.loadOptionsMethod,
			name.startsWith('toolkit') ? 'searchToolkits' : 'searchActions',
			`${name} must be a picker`,
		);
	}

	// The parameter name inside each input row is itself a picker, read from the action's schema.
	const rows = byName('parameterRows');
	assert.equal(rows.type, 'fixedCollection');
	const parameterName = rows.options[0].values.find((v) => v.name === 'name');
	assert.equal(parameterName.typeOptions.loadOptionsMethod, 'getToolParameters');

	// Fields are the default way to set inputs; raw JSON is the opt-in escape hatch.
	const inputMode = byName('inputMode');
	assert.equal(inputMode.default, 'fields');
	assert.deepEqual(inputMode.options.map((o) => o.value), ['fields', 'json']);
	assert.equal(byName('arguments').displayOptions.show.inputMode[0], 'json');
	assert.equal(byName('parameterRows').displayOptions.show.inputMode[0], 'fields');

	// The three pickers the editor calls must actually be implemented.
	const loaders = Object.keys(node.methods.loadOptions);
	assert.deepEqual(loaders.sort(), ['getToolParameters', 'searchActions', 'searchToolkits']);
});

test('the action and connection operations use Composio\u2019s documented argument names', () => {
	const source = readFileSync(join(root, 'nodes/Composio/Composio.node.ts'), 'utf8');

	// COMPOSIO_SEARCH_TOOLS takes queries[].use_case, not a bare query.
	assert.match(source, /queries: \[\{ use_case:/);
	// COMPOSIO_GET_TOOL_SCHEMAS takes tool_slugs and include.
	assert.match(source, /tool_slugs:/);
	assert.match(source, /include: \['input_schema'\]/);
	// COMPOSIO_MULTI_EXECUTE_TOOL takes tools[].tool_slug + arguments, and that required flag.
	assert.match(source, /tools: \[/);
	assert.match(source, /tool_slug: this\.getNodeParameter\('toolSlug'/);
	assert.match(source, /sync_response_to_workbench:/);
});

test('the package declares what n8n loads, with no runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	assert.equal(pkg.name, '@steprotech/n8n-nodes-composio');
	assert.deepEqual(pkg.n8n.nodes, [
		'dist/nodes/Composio/Composio.node.js',
		'dist/nodes/Composio/ComposioTrigger.node.js',
	]);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/ComposioApi.credentials.js']);
	assert.equal(pkg.dependencies, undefined, 'community nodes must ship no runtime dependencies');
	assert.equal(pkg.peerDependencies['n8n-workflow'], '*');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
});

test('the built output contains the compiled node, trigger and credential', () => {
	const distFiles = readdirSync(join(root, 'dist'), { recursive: true }).map((file) =>
		String(file).replaceAll('\\', '/'),
	);
	assert.ok(distFiles.includes('nodes/Composio/Composio.node.js'));
	assert.ok(distFiles.includes('nodes/Composio/ComposioTrigger.node.js'));
	assert.ok(distFiles.includes('credentials/ComposioApi.credentials.js'));
});
