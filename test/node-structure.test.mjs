import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Composio } from '../dist/nodes/Composio/Composio.node.js';
import { ComposioApi } from '../dist/credentials/ComposioApi.credentials.js';
import { META_TOOLS, META_TOOL_OPTIONS } from '../dist/nodes/Composio/metatools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const description = new Composio().description;
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

	assert.deepEqual(operationsFor('connection'), ['connect', 'list', 'remove', 'wait']);
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
	collect(credential.icon, 'credentials');

	assert.equal(iconRefs.length, 4, 'expected light and dark icons for the node and the credential');

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

test('the package declares what n8n loads, with no runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	assert.equal(pkg.name, '@steprotech/n8n-nodes-composio');
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/Composio/Composio.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/ComposioApi.credentials.js']);
	assert.equal(pkg.dependencies, undefined, 'community nodes must ship no runtime dependencies');
	assert.equal(pkg.peerDependencies['n8n-workflow'], '*');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
});

test('the built output contains the compiled node and credential', () => {
	const distFiles = readdirSync(join(root, 'dist'), { recursive: true }).map(String);
	assert.ok(distFiles.includes('nodes/Composio/Composio.node.js'));
	assert.ok(distFiles.includes('credentials/ComposioApi.credentials.js'));
});
