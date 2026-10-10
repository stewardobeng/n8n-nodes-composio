import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ComposioApi implements ICredentialType {
	name = 'composioApi';

	displayName = 'Composio API';

	documentationUrl = 'https://docs.composio.dev/kb/guide/consumer-project-boundaries-and-auth-selection';

	icon = { light: 'file:composio.svg', dark: 'file:composio.dark.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Consumer Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Composio consumer key, the one that starts with ck_. Find it in the Composio dashboard under Connect, Clients, API key. It is sent as the x-consumer-api-key header.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://connect.composio.dev',
			description: 'The Composio Connect base URL. Only change this if Composio tells you to.',
		},
		{
			displayName: 'Default User ID',
			name: 'userId',
			type: 'string',
			default: '',
			description:
				'Optional. The Composio user ID whose connections this credential uses by default. Composio derives one from the key when this is left empty. Use separate credentials if you keep several users apart.',
		},
	];

	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				'x-consumer-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/mcp',
			method: 'POST' as const,
			headers: {
				Accept: 'application/json, text/event-stream',
				'Content-Type': 'application/json',
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: {
						name: 'n8n-nodes-composio',
						version: '0.1.0',
					},
				},
			},
		},
	};
}
