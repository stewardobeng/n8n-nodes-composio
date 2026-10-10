/**
 * Composio Connect exposes seven meta-tools over MCP. The node calls these rather
 * than the thousands of upstream app tools, so nothing here depends on how many
 * toolkits Composio adds.
 *
 * Names verified against Composio's connect documentation. Argument shapes are
 * best-effort and are deliberately passed through from the node, so the advanced
 * operation still works if Composio changes a field name.
 */
export const META_TOOLS = {
	searchTools: 'COMPOSIO_SEARCH_TOOLS',
	getToolSchemas: 'COMPOSIO_GET_TOOL_SCHEMAS',
	multiExecuteTool: 'COMPOSIO_MULTI_EXECUTE_TOOL',
	manageConnections: 'COMPOSIO_MANAGE_CONNECTIONS',
	waitForConnections: 'COMPOSIO_WAIT_FOR_CONNECTIONS',
	remoteWorkbench: 'COMPOSIO_REMOTE_WORKBENCH',
	remoteBash: 'COMPOSIO_REMOTE_BASH_TOOL',
} as const;

export type MetaToolName = (typeof META_TOOLS)[keyof typeof META_TOOLS];

/**
 * Connection management actions accepted by COMPOSIO_MANAGE_CONNECTIONS.
 * Composio names these create, list, rename and remove.
 */
export const CONNECTION_ACTIONS = {
	create: 'create',
	list: 'list',
	remove: 'remove',
} as const;

export const META_TOOL_OPTIONS = [
	{ name: 'Manage Connections', value: META_TOOLS.manageConnections },
	{ name: 'Multi Execute Tool', value: META_TOOLS.multiExecuteTool },
	{ name: 'Search Tools', value: META_TOOLS.searchTools },
	{ name: 'Get Tool Schemas', value: META_TOOLS.getToolSchemas },
	{ name: 'Wait For Connections', value: META_TOOLS.waitForConnections },
	{ name: 'Remote Workbench (Python Sandbox)', value: META_TOOLS.remoteWorkbench },
	{ name: 'Remote Bash (Sandbox Shell)', value: META_TOOLS.remoteBash },
];
