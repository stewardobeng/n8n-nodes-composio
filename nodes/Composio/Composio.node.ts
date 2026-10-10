import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildArgumentsFromRows, extractParameters, extractToolkits, extractTools } from './catalog';
import { callMetaTool, fetchToolSchemas, manageConnections, searchCatalog } from './GenericFunctions';
import { META_TOOL_OPTIONS, META_TOOLS } from './metatools';

const resourceOptions: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Action',
			value: 'action',
			description: 'Find an app action and run it against a connected account',
		},
		{
			name: 'Connection',
			value: 'connection',
			description: 'Connect an app, check which apps are connected, or reconnect one',
		},
		{
			name: 'Advanced',
			value: 'advanced',
			description: 'Call any Composio meta-tool directly with your own arguments',
		},
	],
	default: 'action',
};

const operationOptions: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['action'] } },
		options: [
			{
				name: 'Execute an Action',
				value: 'execute',
				description: 'Run the chosen action with the inputs you fill in',
				action: 'Execute an action',
			},
			{
				name: 'Get Action Inputs',
				value: 'schemas',
				description: 'List the inputs one or more actions expect',
				action: 'Get action inputs',
			},
			{
				name: 'Search Actions',
				value: 'search',
				description: 'Search the Composio catalog for actions matching what you want to do',
				action: 'Search actions',
			},
		],
		default: 'search',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['connection'] } },
		options: [
			{
				name: 'Check Connections',
				value: 'check',
				description: 'Report which of the chosen apps are connected',
				action: 'Check connections',
			},
			{
				name: 'Connect an App',
				value: 'connect',
				description: 'Start the authorization flow and return the link to open',
				action: 'Connect an app',
			},
			{
				name: 'Reconnect an App',
				value: 'reconnect',
				description: 'Replace a connection with a fresh authorization flow',
				action: 'Reconnect an app',
			},
		],
		default: 'connect',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['advanced'] } },
		options: [
			{
				name: 'Call a Meta-Tool',
				value: 'call',
				description: 'Send any Composio meta-tool with arguments you supply as JSON',
				action: 'Call a meta tool',
			},
		],
		default: 'call',
	},
];

const fields: INodeProperties[] = [
	// Connection
	{
		displayName: 'App Name or ID',
		name: 'toolkit',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'searchToolkits' },
		default: '',
		required: true,
		description: 'The app to work with. Type part of a name such as gmail or sheets and pick from the list. Apps you have already connected are marked. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['connection'], operation: ['connect', 'reconnect'] } },
	},
	{
		displayName: 'App Names or IDs',
		name: 'toolkits',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'searchToolkits' },
		default: [],
		required: true,
		description: 'The apps to check. Search and add each one. Any app that is not connected yet gets an authorization link in the output. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['connection'], operation: ['check'] } },
	},
	// Action
	{
		displayName: 'Search For',
		name: 'useCase',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'send an email with an attachment',
		description:
			'What you want to do, in plain words. Composio returns matching actions, which app each belongs to, and which of those apps are already connected.',
		displayOptions: { show: { resource: ['action'], operation: ['search'] } },
	},
	{
		displayName: 'Action Name or ID',
		name: 'toolSlug',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'searchActions' },
		default: '',
		required: true,
		description: 'The action to run. Type part of what it does, or of its name, and pick from the list. Use Search Actions first if you are unsure. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['action'], operation: ['execute'] } },
	},
	{
		displayName: 'Action Names or IDs',
		name: 'toolSlugs',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'searchActions' },
		default: [],
		required: true,
		description: 'The actions whose inputs you want to see. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['action'], operation: ['schemas'] } },
	},
	{
		displayName: 'Set Inputs',
		name: 'inputMode',
		type: 'options',
		options: [
			{
				name: 'Using Fields',
				value: 'fields',
				description: 'Pick each input by name and type its value, with no JSON to write',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'Write the whole arguments object yourself',
			},
		],
		default: 'fields',
		description: 'How to provide the action inputs',
		displayOptions: { show: { resource: ['action'], operation: ['execute'] } },
	},
	{
		displayName: 'Input Parameters',
		name: 'parameterRows',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Input',
		description:
			'The inputs this action needs. Add one row per input and pick its name from the list, which is read from the action itself. Values that look like JSON, such as true, 42 or {"a":1}, are sent as JSON.',
		displayOptions: { show: { resource: ['action'], operation: ['execute'], inputMode: ['fields'] } },
		options: [
			{
				displayName: 'Input',
				name: 'parameters',
				values: [
					{
						displayName: 'Parameter Name or ID',
						name: 'name',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getToolParameters' },
						default: '',
						description: 'Which input of the action to set. The list is read from the action chosen above, and marks the required ones. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description:
							'The value to send. Numbers, true, false, null, and JSON objects or arrays are recognised automatically. Everything else is sent as text.',
					},
				],
			},
		],
	},
	{
		displayName: 'Arguments (JSON)',
		name: 'arguments',
		type: 'json',
		default: '{}',
		description: 'The full arguments object, exactly as the action expects it',
		displayOptions: { show: { resource: ['action'], operation: ['execute'], inputMode: ['json'] } },
	},
	{
		displayName: 'Save Large Responses in the Workbench',
		name: 'syncToWorkbench',
		type: 'boolean',
		default: false,
		description:
			'Whether Composio should keep the full response in its workbench and return only a preview, which helps when an action returns something big',
		displayOptions: { show: { resource: ['action'], operation: ['execute'] } },
	},
	// Advanced
	{
		displayName: 'Meta-Tool',
		name: 'metaTool',
		type: 'options',
		options: META_TOOL_OPTIONS,
		default: 'COMPOSIO_SEARCH_TOOLS',
		description: 'The Composio meta-tool to send',
		displayOptions: { show: { resource: ['advanced'], operation: ['call'] } },
	},
	{
		displayName: 'Arguments (JSON)',
		name: 'metaArguments',
		type: 'json',
		default: '{}',
		description: 'The meta-tool arguments, exactly as Composio documents them',
		displayOptions: { show: { resource: ['advanced'], operation: ['call'] } },
	},
	// Shared
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'string',
		default: '',
		description:
			'Optional. Override the user whose connections are used. Leave empty to use the credential default.',
	},
];

export class Composio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Composio Connect',
		name: 'composio',
		icon: { light: 'file:composio.svg', dark: 'file:composio.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Connect your own apps through Composio and run their actions in any workflow',
		defaults: { name: 'Composio Connect' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'composioApi', required: true }],
		properties: [resourceOptions, ...operationOptions, ...fields],
	};

	methods = {
		loadOptions: {
			/**
			 * The consumer surface has no list-toolkits meta-tool, so the catalog is read through
			 * COMPOSIO_SEARCH_TOOLS, whose response names every toolkit it touched together with its
			 * connection status. Typing into the picker performs a real search.
			 */
			async searchToolkits(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodePropertyOptions[]> {
				const search = (filter ?? '').trim();
				const data = await searchCatalog(this, search === '' ? 'popular apps and their actions' : search);
				const toolkits = extractToolkits(data);
				if (toolkits.length === 0) {
					return [
						{
							name: 'No App Matched. Keep Typing, for Example Gmail, Slack or Sheets.',
							value: '',
							description: 'No match',
						},
					];
				}
				return toolkits.map((entry) => ({
					name: `${entry.toolkit}${entry.connected ? ' (connected)' : ''}`,
					value: entry.toolkit,
					description: entry.description === '' ? 'Composio app' : entry.description.slice(0, 120),
				}));
			},

			async searchActions(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodePropertyOptions[]> {
				const search = (filter ?? '').trim();
				const data = await searchCatalog(this, search === '' ? 'common actions' : search);
				const tools = extractTools(data);
				if (tools.length === 0) {
					return [
						{
							name: 'No Action Matched. Describe What You Want to Do, for Example Send an Email.',
							value: '',
							description: 'No match',
						},
					];
				}
				return tools.map((tool) => ({
					name: tool.slug,
					value: tool.slug,
					description: `${tool.toolkit}${tool.description === '' ? '' : ' — ' + tool.description.slice(0, 110)}`,
				}));
			},

			/** Reads the chosen action's own input schema so the user picks field names instead of writing JSON. */
			async getToolParameters(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const toolSlug = (this.getCurrentNodeParameter('toolSlug') as string) || '';
				if (toolSlug === '') {
					return [
						{
							name: 'Choose an Action Above First',
							value: '',
							description: 'An action is needed before its inputs can be listed',
						},
					];
				}
				const data = await fetchToolSchemas(this, [toolSlug]);
				const parameters = extractParameters(data, toolSlug);
				if (parameters.length === 0) {
					return [
						{
							name: 'This Action Reports No Inputs, or Its Schema Could Not Be Read. Use Using JSON if You Know the Fields.',
							value: '',
							description: 'No inputs found',
						},
					];
				}
				return parameters.map((parameter) => ({
					name: `${parameter.name}${parameter.required ? ' (required)' : ''}`,
					value: parameter.name,
					description: `${parameter.type}${parameter.description === '' ? '' : ' — ' + parameter.description.slice(0, 110)}`,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('composioApi');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const nodeUserId = (this.getNodeParameter('userId', i, '') as string) || undefined;
				const userId = nodeUserId || ((credentials.userId as string | undefined) || undefined);

				const push = (payload: IDataObject): void => {
					returnData.push({ json: payload, pairedItem: { item: i } });
				};

				if (resource === 'connection') {
					if (operation === 'check') {
						const toolkits = (this.getNodeParameter('toolkits', i, []) as string[]).filter(
							(toolkit) => toolkit !== '',
						);
						const outcome = await manageConnections(this, toolkits);
						push({
							tool: outcome.tool,
							data: outcome.data as IDataObject,
							raw: outcome.text,
							isError: outcome.isError,
						});
						continue;
					}

					const toolkit = this.getNodeParameter('toolkit', i) as string;
					const outcome = await manageConnections(this, [toolkit], operation === 'reconnect');
					push({
						tool: outcome.tool,
						data: outcome.data as IDataObject,
						raw: outcome.text,
						isError: outcome.isError,
					});
					continue;
				}

				let tool: string;
				let args: Record<string, unknown>;

				if (resource === 'action') {
					if (operation === 'search') {
						tool = META_TOOLS.searchTools;
						args = {
							queries: [{ use_case: this.getNodeParameter('useCase', i) as string }],
							session: { generate_id: true },
						};
					} else if (operation === 'schemas') {
						tool = META_TOOLS.getToolSchemas;
						args = {
							tool_slugs: (this.getNodeParameter('toolSlugs', i, []) as string[]).filter(
								(slug) => slug !== '',
							),
							include: ['input_schema'],
						};
					} else {
						const inputMode = this.getNodeParameter('inputMode', i, 'fields') as string;
						let toolArguments: Record<string, unknown>;

						if (inputMode === 'json') {
							const raw = this.getNodeParameter('arguments', i, '{}') as string | IDataObject;
							toolArguments =
								typeof raw === 'string'
									? (JSON.parse(raw === '' ? '{}' : raw) as IDataObject)
									: (raw as IDataObject);
						} else {
							const rows = this.getNodeParameter('parameterRows.parameters', i, []) as Array<{
								name?: unknown;
								value?: unknown;
							}>;
							toolArguments = buildArgumentsFromRows(rows);
						}

						tool = META_TOOLS.multiExecuteTool;
						args = {
							tools: [
								{
									tool_slug: this.getNodeParameter('toolSlug', i) as string,
									arguments: toolArguments,
								},
							],
							sync_response_to_workbench: this.getNodeParameter('syncToWorkbench', i, false) as boolean,
						};
					}
				} else {
					tool = this.getNodeParameter('metaTool', i) as string;
					const rawMetaArguments = this.getNodeParameter('metaArguments', i, '{}') as
						| string
						| IDataObject;
					const parsed =
						typeof rawMetaArguments === 'string'
							? (JSON.parse(rawMetaArguments === '' ? '{}' : rawMetaArguments) as IDataObject)
							: rawMetaArguments;
					args = { ...parsed };
				}

				if (userId !== undefined) args.user_id = userId;

				const outcome = await callMetaTool(this, tool, args);

				push({
					tool: outcome.tool,
					data: outcome.data as IDataObject,
					raw: outcome.text,
					isError: outcome.isError,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
