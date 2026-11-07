# Publishing @steprotech/n8n-nodes-composio

The source repository is https://github.com/stewardobeng/n8n-nodes-composio. The package already exists on npm;
published versions cannot be replaced. Publish a new version for each release.

For n8n Creator Portal verification, n8n requires publication from GitHub Actions with npm
provenance. See https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.
The repository's `.github/workflows/publish.yml` builds, lints and tests through the package's
`prepublishOnly` script and publishes a matching `v`-prefixed version tag with provenance.

## One-time setup

In npm package settings, add a GitHub Actions Trusted Publisher with owner `stewardobeng`,
repository `n8n-nodes-composio`, and workflow filename `publish.yml`. Leave the environment
blank and enable `npm publish` for direct releases. The GitHub account must be able to run Actions.
The workflow uses OIDC and does not require a long-lived npm token.

## Release

1. Complete the n8n verification review, build, lint, tests and package scan. Check that GitHub's
   Verify workflow succeeds and review any skipped live tests.
2. Update the version in `package.json` and `package-lock.json`, commit the changes, and push them
   to the `main` branch of https://github.com/stewardobeng/n8n-nodes-composio. Use a suitable version for any breaking changes.
3. After confirming npm Trusted Publishing and GitHub Actions are available, create and push a tag
   exactly matching the package version, for example `v1.2.3`. The push triggers publication.
4. Check the GitHub Actions result, then verify the npm version, repository URL and provenance
   attestation. An existing npm version cannot be overwritten.

Publishing to npm and submission for n8n verification are separate actions. Local publication or
GitLab CI publication may be valid for npm but does not meet n8n's GitHub Actions requirement.
