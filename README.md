# @steprotech/n8n-nodes-composio

An n8n node for [Composio](https://composio.dev). Connect your own apps through Composio, choose an
action, and run it in any workflow. No AI agent is required, and the node can also be used as a tool
inside an agent.

Composio is an integration and authentication layer: it holds the OAuth grants for around 1,600
apps, refreshes the tokens, and executes the action on your behalf. This node is the n8n front door
to that, over Composio Connect and its MCP endpoint.

## Install

Self-hosted n8n only, because it is a community node.

1. In n8n, open **Settings > Community Nodes**.
2. Select **Install** and enter `@steprotech/n8n-nodes-composio`.
3. Restart n8n if prompted.

From a shell, inside your n8n user folder:

```bash
cd ~/.n8n/nodes
npm install @steprotech/n8n-nodes-composio --legacy-peer-deps
```

`--legacy-peer-deps` matters: the package declares `n8n-workflow` as a peer, which n8n supplies at
runtime. A plain install tries to fetch it and can fail building a native dependency.

## Credential

Create a **Composio API** credential and paste your **consumer key**, the one starting with `ck_`.
Find it in the Composio dashboard under **Connect > Clients > API key**. It is sent as the
`x-consumer-api-key` header.

Never paste a key into a chat, an issue or a repository. Keys belong in n8n's credential form only.

## Operations

**Connection**

- **Connect an App** returns the authorization link. Open it, approve in the browser, and the app is
  connected to your Composio account. Managed auth means you never create an OAuth app yourself.
- **Wait for Connection** pauses until you finish authorizing, so the next node can rely on it.
- **List Connections** shows which apps are connected.
- **Remove Connection** disconnects an app and deletes its stored credentials.

**Action**

- **Search Actions** takes what you want to do in plain words and returns matching actions.
- **Get Action Schemas** fetches the input schema for an action slug, so you know which fields to send.
- **Execute an Action** runs an action slug with JSON arguments against the connected account. It can
  also be used as a tool by an AI Agent.

**Advanced**

- **Call a Meta-Tool** sends any of Composio's seven meta-tools with arguments you supply. Composio
  has thousands of actions with their own schemas, while n8n node parameters are fixed, so this
  operation is the escape hatch if an action needs something the other operations do not cover yet.

## Composio's meta-tools

The node speaks MCP over streamable HTTP to `https://connect.composio.dev/mcp` and uses Composio's
own meta-tools rather than calling app APIs directly:

`COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`,
`COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_WAIT_FOR_CONNECTIONS`, `COMPOSIO_REMOTE_WORKBENCH`,
`COMPOSIO_REMOTE_BASH_TOOL`.

## Free tier

Composio's free plan includes 100,000 tool calls and 50,000 trigger events a month, with unlimited
free connected accounts, and it is hard capped so there is no surprise bill. Using Composio-managed
apps, which is the click-and-authorize path, draws on 20,000 of those calls and the first 1,000
connections. Check Composio's pricing page before relying on the numbers.

## Attribution

This is an unofficial community node. Composio is a trademark of its owner, and the node icon is
Composio's own mark as published at `logos.composio.dev`. This package is not affiliated with or
endorsed by Composio.

## License

MIT. See LICENSE.
