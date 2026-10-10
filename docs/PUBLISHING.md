# Publishing @steprotech/n8n-nodes-composio

## Who publishes

The package is scoped to the npm organization `steprotech`, so only a member of that organization can
publish it. `npm login` with such an account, then publish.

A scoped package needs `--access public` on every publish. Without it npm refuses, because scoped
packages default to restricted.

## The release loop

```bash
npm version patch --no-git-tag-version    # or minor / major
npm run build
npm run lint
npm test
npm pack                                  # produces steprotech-n8n-nodes-composio-<version>.tgz
npm publish <that tarball> --access public
npm view @steprotech/n8n-nodes-composio version
```

`prepublishOnly` runs `build && lint && test` automatically on `npm publish`, so a broken tree cannot
be published by accident. The guard exists because the n8n starter's own `prepublishOnly` calls
`n8n-node prerelease`, which refuses a plain `npm publish`.

Published versions are immutable. To fix a bad release: `npm deprecate
@steprotech/n8n-nodes-composio@<version> "reason"`, then publish a patch. Unpublishing is allowed
only within 72 hours and only under npm's criteria, so treat deprecate-then-fix as the real path.

## Do you need a GitHub account?

No. npm needs an npm account with a verified email, a publish token or an interactive login, and a
free package name. Being a member of the `steprotech` organization is what the scope requires.

GitHub matters in exactly two places:

1. The optional `repository` link in `package.json`.
2. n8n's **verified community node** badge. Since 1 May 2026 that programme requires publishing from
   GitHub Actions with provenance, so the badge is unavailable while the GitHub account is suspended.

Everything else works from GitLab, which is where this repository lives.

## Continuous integration

`.gitlab-ci.yml` defines two jobs:

- **verify** runs on every branch push and merge request: install, build, lint, test. No credentials
  needed.
- **publish** is manual and tag-only. It publishes with an npm provenance statement signed by
  Sigstore, which requires a CI/CD variable named `NPM_TOKEN`, masked and protected, holding an npm
  token with publish permission. Provenance is **not** generated for packages whose repository is
  private, and this GitLab project is private, so the statement appears only if the repository is
  made public.

### The better path: trusted publishing, no token

npm restricts tokens that bypass two-factor authentication, with direct publishing affected from
January 2027, so the token should eventually go. npm supports trusted publishing from **GitLab
CI/CD**, which authenticates with a short-lived OIDC token instead of a stored secret.

1. The package must already exist on npm, so this comes after a first manual publish.
2. On npmjs.com: package **Settings > Trusted publishing > GitLab CI/CD**, with namespace
   `steprotech`, project name `n8n-nodes-composio`, top-level CI file path `.gitlab-ci.yml`, and
   `npm publish` among the allowed actions.
3. The pipeline already carries the required `id_tokens` block with the audience
   `npm:registry.npmjs.org`, so no workflow change is needed to switch over.

Once OIDC works, set **Settings > Publishing access > Require two-factor authentication and disallow
tokens**, which removes the long-lived secret as an attack path.

## Packaging rules n8n enforces

- `dependencies` must stay empty. `n8n-workflow` is a peer.
- Node and credential icon references must resolve to real square SVG files at build time, shipped in
  `dist`.
- Every parameter and every operation needs a description, because those strings are what an AI agent
  reads when the node is used as a tool.
- Display names must be unique across everything installed on an instance, because n8n keys its
  `installed_nodes` table on them.
