import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { checkSignature, DEFAULT_TOLERANCE_SECONDS } from './signature';

function headerValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value ?? undefined;
}

/**
 * Leaves room for the third-party n8n-nodes-composio package, whose node, trigger and webhook path
 * all use the bare word: n8n keys installed nodes on the display name and refuses to register two
 * webhooks on one path, so both packages installed side by side would otherwise fail.
 */
export class ComposioTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Composio Connect Trigger',
		name: 'composioTrigger',
		icon: { light: 'file:composio.svg', dark: 'file:composio.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow when something happens in an app connected through Composio',
		defaults: { name: 'Composio Connect Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'composioApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'composio-connect',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['composio.trigger.message'],
				options: [
					{
						name: 'Any Event',
						value: '*',
						description: 'Every event Composio sends to this URL',
					},
					{
						name: 'Trigger Message',
						value: 'composio.trigger.message',
						description: 'An event from an app, such as a new email or a new commit',
					},
					{
						name: 'Connected Account Expired',
						value: 'composio.connected_account.expired',
						description: 'A connected account needs re-authorizing',
					},
				],
				description: 'Which Composio events should start this workflow',
			},
			{
				displayName: 'Only These Triggers',
				name: 'triggerSlugs',
				type: 'string',
				default: '',
				placeholder: 'GITHUB_COMMIT_EVENT, GMAIL_NEW_GMAIL_MESSAGE',
				description:
					'Optional. Which trigger slugs to accept. Add several separated by commas. Leave empty to accept every trigger in the selected events.',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to reject requests whose Composio signature does not match, which stops anyone who learns the URL from injecting events. It needs the webhook signing secret saved in the credential.',
			},
			{
				displayName: 'Signature Tolerance (Seconds)',
				name: 'toleranceSeconds',
				type: 'number',
				default: DEFAULT_TOLERANCE_SECONDS,
				displayOptions: { show: { verifySignature: [true] } },
				description:
					'How old a request may be before it is refused, which blocks replayed payloads. Composio signs with the current time, so keep this generous enough for clock drift.',
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * Composio delivers every event of a project to a single webhook URL that you register in
			 * its dashboard, and the consumer key this node uses cannot change that registration. So
			 * there is nothing to create or remove from here: the node simply receives and verifies.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headers = this.getHeaderData();
		const body = this.getBodyData();
		const verifySignature = this.getNodeParameter('verifySignature', false) as boolean;

		const webhookId = headerValue(headers['webhook-id']);
		const webhookTimestamp = headerValue(headers['webhook-timestamp']);
		const webhookSignature = headerValue(headers['webhook-signature']);

		if (verifySignature) {
			const credentials = await this.getCredentials('composioApi');
			const secret = ((credentials.webhookSecret as string | undefined) ?? '').trim();

			if (secret === '') {
				throw new NodeOperationError(
					this.getNode(),
					'Signature verification is on but the credential has no webhook signing secret. Add it, or turn verification off if this URL is not reachable from outside.',
				);
			}

			// The signature covers the bytes exactly as sent, so the raw body is required. Re-serialising
			// the parsed body would change the encoding and break the comparison.
			const request = this.getRequestObject();
			let rawBody: string | undefined;
			if (request !== undefined && request !== null) {
				if (Buffer.isBuffer(request.rawBody)) {
					rawBody = request.rawBody.toString('utf8');
				} else if (typeof request.readRawBody === 'function') {
					await request.readRawBody();
					rawBody = Buffer.isBuffer(request.rawBody) ? request.rawBody.toString('utf8') : undefined;
				}
			}

			if (rawBody === undefined) {
				throw new NodeOperationError(
					this.getNode(),
					'n8n did not expose the raw request body, so the Composio signature cannot be checked. Verification cannot succeed without it.',
				);
			}

			const result = checkSignature(
				{
					secret,
					rawBody,
					signature: webhookSignature,
					id: webhookId,
					timestamp: webhookTimestamp,
					toleranceSeconds: this.getNodeParameter('toleranceSeconds', DEFAULT_TOLERANCE_SECONDS) as number,
				},
				Date.now(),
			);

			if (!result.ok) {
				throw new NodeOperationError(
					this.getNode(),
					`Rejected a Composio webhook because ${result.reason}.`,
				);
			}
		}

		const event = (body.type as string | undefined) ?? (body.event as string | undefined) ?? 'unknown';
		const metadata = (body.metadata as IDataObject | undefined) ?? {};
		const triggerSlug =
			(metadata.trigger_slug as string | undefined) ?? (metadata.triggerSlug as string | undefined);

		const wantedEvents = this.getNodeParameter('events', []) as string[];
		if (!wantedEvents.includes('*') && !wantedEvents.includes(event)) {
			return { workflowData: [] };
		}

		const slugFilter = ((this.getNodeParameter('triggerSlugs', '') as string) || '')
			.split(',')
			.map((slug) => slug.trim().toUpperCase())
			.filter((slug) => slug !== '');
		if (slugFilter.length > 0 && !slugFilter.includes((triggerSlug ?? '').toUpperCase())) {
			return { workflowData: [] };
		}

		return {
			workflowData: [
				[
					{
						json: {
							event,
							triggerSlug: triggerSlug ?? '',
							webhookId: webhookId ?? '',
							timestamp: webhookTimestamp ?? '',
							verified: verifySignature,
							data: (body.data as IDataObject | undefined) ?? body,
							payload: body,
						},
					},
				],
			],
		};
	}
}
