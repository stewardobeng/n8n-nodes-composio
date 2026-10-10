import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildToolArguments, callMetaTool } from './GenericFunctions';
import { CONNECTION_ACTIONS, META_TOOL_OPTIONS, META_TOOLS } from './metatools';

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
			description: 'Connect an app, wait for it to finish, list connections or remove one',
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
				description: 'Run a tool slug with arguments against the connected account',
				action: 'Execute an action',
			},
			{
				name: 'Get Action Schemas',
				value: 'schemas',
				description: 'Fetch the full input schemas for tool slugs',
				action: 'Get action schemas',
			},
			{
				name: 'Search Actions',
				value: 'search',
				description: 'Search the Composio catalog for actions matching a request',
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
				name: 'Connect an App',
				value: 'connect',
				description: 'Start the authorization flow and return the link to open',
				action: 'Connect an app',
			},
			{
				name: 'Wait for Connection',
				value: 'wait',
				description: 'Wait until you finish authorizing the app in your browser',
				action: 'Wait for a connection',
			},
			{
				name: 'List Connections',
				value: 'list',
				description: 'List the apps already connected to this Composio account',
				action: 'List connections',
			},
			{
				name: 'Remove Connection',
				value: 'remove',
				description: 'Disconnect an app and delete its stored credentials',
				action: 'Remove a connection',
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

const toolkitField = (displayName: string, description: string): INodeProperties => ({
	displayName,
	name: 'toolkit',
	type: 'string',
	default: '',
	required: true,
	description,
	placeholder: 'gmail',
});

const fields: INodeProperties[] = [
	// Connection
	{
		...toolkitField(
			'App (Toolkit)',
			'The app to connect, as a Composio toolkit slug such as gmail, slack, github or googlesheets. Use Action, Search Actions if you do not know the slug.',
		),
		displayOptions: { show: { resource: ['connection'], operation: ['connect', 'remove'] } },
	},
	{
		displayName: 'Wait Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		default: 120,
		description: 'How long to wait for you to finish authorizing in the browser',
		displayOptions: { show: { resource: ['connection'], operation: ['wait'] } },
	},
	// Action
	{
		displayName: 'Search Query',
		name: 'query',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'send an email to a customer',
		description: 'What you want to do, in plain words. Composio returns matching actions and a plan.',
		displayOptions: { show: { resource: ['action'], operation: ['search'] } },
	},
	{
		displayName: 'Tool Slugs',
		name: 'toolSlugs',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'GMAIL_SEND_EMAIL, GMAIL_FETCH_EMAILS',
		description: 'One or more action slugs, separated by commas. Get them from Search Actions.',
		displayOptions: { show: { resource: ['action'], operation: ['schemas'] } },
	},
	{
		displayName: 'Action Slug',
		name: 'toolSlug',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'GMAIL_SEND_EMAIL',
		description: 'The action to run, as Composio names it. Get it from Search Actions.',
		displayOptions: { show: { resource: ['action'], operation: ['execute'] } },
	},
	{
		displayName: 'Arguments (JSON)',
		name: 'arguments',
		type: 'json',
		default: '{}',
		description:
			'The inputs for this action, as JSON. Run Get Action Schemas to see which fields it expects.',
		displayOptions: { show: { resource: ['action'], operation: ['execute'] } },
	},
	{
		displayName: 'App (Toolkit)',
		name: 'toolkit',
		type: 'string',
		default: '',
		description: 'Optional. Restrict the action to this toolkit, for example gmail.',
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
		defaults: { name: 'Composio' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'composioApi', required: true }],
		properties: [resourceOptions, ...operationOptions, ...fields],
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
				const userId =
					nodeUserId || ((credentials.userId as string | undefined) || undefined);
				const resolvedUserId = userId || undefined;

				let tool: string;
				let args: Record<string, unknown>;

				if (resource === 'connection') {
					const toolkit = this.getNodeParameter('toolkit', i) as string;
					if (operation === 'connect') {
						tool = META_TOOLS.manageConnections;
						args = buildToolArguments({
							action: CONNECTION_ACTIONS.create,
							toolkit,
							user_id: resolvedUserId,
						});
					} else if (operation === 'wait') {
						const timeout = this.getNodeParameter('timeout', i, 120) as number;
						tool = META_TOOLS.waitForConnections;
						args = buildToolArguments({
							timeout,
							user_id: resolvedUserId,
						});
					} else if (operation === 'remove') {
						tool = META_TOOLS.manageConnections;
						args = buildToolArguments({
							action: CONNECTION_ACTIONS.remove,
							toolkit,
							user_id: resolvedUserId,
						});
					} else {
						tool = META_TOOLS.manageConnections;
						args = buildToolArguments({
							action: CONNECTION_ACTIONS.list,
							user_id: resolvedUserId,
						});
					}
				} else if (resource === 'action') {
					if (operation === 'search') {
						const query = this.getNodeParameter('query', i) as string;
						tool = META_TOOLS.searchTools;
						args = buildToolArguments({ query, user_id: resolvedUserId });
					} else if (operation === 'schemas') {
						const raw = this.getNodeParameter('toolSlugs', i) as string;
						const toolSlugs = raw
							.split(',')
							.map((slug) => slug.trim())
							.filter((slug) => slug !== '');
						tool = META_TOOLS.getToolSchemas;
						args = buildToolArguments({ tool_slugs: toolSlugs, user_id: resolvedUserId });
					} else {
						const toolSlug = this.getNodeParameter('toolSlug', i) as string;
						const rawArguments = this.getNodeParameter('arguments', i, '{}') as
							| string
							| IDataObject;
						const toolkit = (this.getNodeParameter('toolkit', i, '') as string) || undefined;
						const parsedArguments =
							typeof rawArguments === 'string'
								? (JSON.parse(rawArguments === '' ? '{}' : rawArguments) as IDataObject)
								: rawArguments;
						tool = META_TOOLS.multiExecuteTool;
						args = buildToolArguments({
							tools: [{ tool_slug: toolSlug, arguments: parsedArguments }],
							toolkits: toolkit === undefined ? undefined : [toolkit],
							user_id: resolvedUserId,
						});
					}
				} else {
					tool = this.getNodeParameter('metaTool', i) as string;
					const rawMetaArguments = this.getNodeParameter('metaArguments', i, '{}') as
						| string
						| IDataObject;
					const parsedMetaArguments =
						typeof rawMetaArguments === 'string'
							? (JSON.parse(rawMetaArguments === '' ? '{}' : rawMetaArguments) as IDataObject)
							: rawMetaArguments;
					args = buildToolArguments({ ...parsedMetaArguments, user_id: resolvedUserId });
				}

				const outcome = await callMetaTool(this, tool, args);

				returnData.push({
					json: {
						tool: outcome.tool,
						data: outcome.data as IDataObject,
						raw: outcome.text,
						isError: outcome.isError,
					},
					pairedItem: { item: i },
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
