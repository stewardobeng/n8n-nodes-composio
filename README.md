# @steprotech/n8n-nodes-composio

An n8n node for [Composio](https://composio.dev). Connect your own apps through Composio, choose an
action, and run it in any workflow. No AI agent is required, and the node can also be used as a tool
inside an agent. A trigger node starts workflows from app events too.

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

Every app and every action is chosen from a **live search list**, so you never need to know a Composio
slug. The inputs of an action are read from the action's own schema, so you pick parameter names from a
list instead of writing JSON. Raw JSON is still there as an opt-in escape hatch.

**Connection**

- **Connect an App** returns the authorization link. Open it, approve in the browser, and the app is
  connected to your Composio account. Managed auth means you never create an OAuth app yourself.
- **Check Connections** reports which of the apps you name are connected. Any app that is not connected
  yet gets an authorization link in the output, so this doubles as "connect these three apps".
- **Reconnect an App** replaces an existing connection with a fresh authorization flow, which is what
  you want when credentials go stale or when you need to re-consent after a permission change.

Disconnecting an app is not exposed on the consumer surface this node uses, so removal stays in the
Composio dashboard.

**Action**

- **Search Actions** takes what you want to do in plain words and returns matching actions, which app
  each belongs to, and which of those apps are already connected.
- **Get Action Inputs** lists the inputs one or more actions expect, with types and required markers.
- **Execute an Action** runs the chosen action. Set **Set Inputs** to *Using Fields* and add one row per
  input, picking the parameter name from the list, or switch to *Using JSON* to write the arguments
  object yourself. The node can also be used as a tool by an AI Agent.

Values typed into the fields are converted sensibly: `true`, `false`, `null`, numbers and JSON objects
or arrays are sent as those types, while identifiers keep their form, so a phone number entered as
`0244123456` is not turned into a number.

**Advanced**

- **Call a Meta-Tool** sends any of Composio's meta-tools with arguments you supply. Composio has
  thousands of actions with their own schemas, while n8n node parameters are fixed, so this is the
  escape hatch for anything the operations above do not cover yet.

## Documentation

- `docs/INSTALL-OPTIONS.md` covers every way to install or update it, including troubleshooting.
- `docs/PUBLISHING.md` covers the release loop, CI, and the tokenless trusted-publishing path.
- `docs/PUBLISH-FROM-WINDOWS.md` is the PowerShell route for publishing from your own machine.

## Trigger

The **Composio Connect Trigger** starts a workflow when something happens in a connected app, such as
a new Gmail message or a new GitHub commit.

1. In Composio, note the single **webhook URL** your project delivers events to, and register the URL
   n8n shows in the trigger node. Composio sends every project event to one URL, so this is a
   per-project setting, not a per-workflow one.
2. Copy the webhook **signing secret** from that subscription into the credential's *Webhook Signing
   Secret* field.
3. Choose the events you want. `Trigger Message` covers app events; `Connected Account Expired` tells
   you when a connection needs re-authorizing. Use `Only These Triggers` to accept a single trigger
   slug such as `GITHUB_COMMIT_EVENT`.

Signature verification is **on by default**. Every request carries `webhook-id`, `webhook-timestamp`
and `webhook-signature`, and the trigger recomputes an HMAC-SHA256 over
`{webhook-id}.{webhook-timestamp}.{body}`, compares it in constant time, and refuses anything older
than the tolerance (300 seconds by default) so a captured payload cannot be replayed. Note this while
writing it down: with verification on and no secret in the credential, the trigger refuses to run
rather than trusting the request, which is deliberate.

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
