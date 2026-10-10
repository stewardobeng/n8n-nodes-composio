# Installing @steprotech/n8n-nodes-composio

Community nodes are only installable on **self-hosted n8n**. There is no n8n Cloud path, because
Cloud only accepts verified nodes.

## From the n8n interface

1. Open **Settings > Community Nodes**.
2. Select **Install**, then enter `@steprotech/n8n-nodes-composio`.
3. Accept the community node warning and confirm.
4. Restart n8n if the node does not appear immediately.

n8n installs the latest published version and offers an **Update** button on the package row when a
newer one exists.

## From a shell, on the machine or container running n8n

```bash
cd ~/.n8n/nodes
npm install @steprotech/n8n-nodes-composio --legacy-peer-deps --no-audit --no-fund
```

Restart n8n afterwards.

`--legacy-peer-deps` matters. The package declares `n8n-workflow` as a peer dependency, which n8n
supplies at runtime. A plain install tries to fetch it from the registry and can fail while building
its native `isolated-vm` dependency.

In Docker, the user folder is a volume, so install inside the container:

```bash
docker cp steprotech-n8n-nodes-composio-0.1.1.tgz <container>:/tmp/pkg.tgz
docker exec <container> sh -lc "cd /home/node/.n8n/nodes && npm install /tmp/pkg.tgz --legacy-peer-deps --no-audit --no-fund"
docker restart <container>
```

On a fresh instance that has never installed a community node, create the folder first:
`mkdir -p ~/.n8n/nodes`.

## From a downloaded tarball, before publishing

Same as the Docker example above with any `.tgz` path. Use this to test a build that is not on npm
yet. Verify the file hash first, since a truncated download fails late and confusingly:

```bash
sha256sum steprotech-n8n-nodes-composio-0.1.1.tgz
```

## Updating

- **Interface:** the package row shows **Update** when a newer version exists.
- **Shell:** `npm update @steprotech/n8n-nodes-composio` inside `~/.n8n/nodes`, then restart.
- **Docker with a pinned version:** install the new tarball with the same command, then restart.

Published npm versions are immutable, so an update is always a new version number. To withdraw a
broken one, `npm deprecate` it and publish a fix.

## Troubleshooting

**`Failed to save installed package ... UNIQUE constraint failed: installed_nodes.name`**
n8n keys installed nodes on the node's **display name**, so two nodes cannot share one. If you also
have the third-party `n8n-nodes-composio` installed, its nodes use the bare names `Composio` and
`Composio Trigger`; this package deliberately uses `Composio Connect` and `Composio Connect Trigger`
so the two can coexist. If an orphan row remains from an earlier failed attempt, uninstall the
package that owns the conflicting name in the interface, or remove the stale row from
`installed_nodes` after backing up `database.sqlite` and stopping n8n.

**The node installs but does not appear**
Restart n8n, then hard refresh the editor with Ctrl+Shift+R. n8n caches node assets in the browser.

**Credential refuses to save**
The credential test opens an MCP session against Composio. Check the key looks like `ck_...`, that it
belongs to the workspace you expect, and that the base URL is `https://connect.composio.dev`.
