# Publishing from a Windows machine

Everything below runs in PowerShell on your own computer. No SSH, no token stored on any server.

## Route A: publish the tarball you were given

The maintainer builds and packs the release, you publish the exact file. This is the shortest path and
the one to prefer, because the artifact is verified before it reaches you.

```powershell
# 1. find the file wherever it downloaded
$tgz = (Get-ChildItem -Path $env:USERPROFILE -Filter "*n8n-nodes-composio-*.tgz" -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$tgz
Get-FileHash $tgz -Algorithm SHA256

# 2. confirm you are logged in as an account that belongs to the steprotech organization
npm whoami

# 3. publish
npm publish $tgz --access public

# 4. confirm it is live
npm view @steprotech/n8n-nodes-composio version dist.tarball
```

Compare the hash with the one given to you before publishing. A truncated download is the usual
reason for a confusing npm error, and the hash catches it in one second.

`npm login` asks for your username, password and a one-time code. Type them into your own terminal.
Never paste a password, a token or a one-time code into a chat, an issue, or a file in the repository.

`--access public` is required for a scoped package. It must be on every publish, not just the first.

## Route B: build and publish from source

Use this if you want to publish your own changes.

```powershell
git clone git@gitlab.com:steprotech/n8n-nodes-composio.git
cd n8n-nodes-composio
npm ci --ignore-scripts
npm run build
npm run lint
npm test
npm publish --access public
```

- `npm ci` installs exactly what `package-lock.json` pins.
- `--ignore-scripts` skips optional native builds (`isolated-vm`, `cpu-features`, `ssh2`). None of them
  are needed to build or publish this package, and skipping them avoids needing a C++ toolchain on
  Windows.
- `npm publish` runs `build && lint && test` again through `prepublishOnly`, so a failing test stops
  the publish before anything reaches the registry.

## What the values mean

- **Version:** `0.1.1`. Each publish needs a new one. Use `npm version patch --no-git-tag-version`
  before publishing if you changed anything.
- **Package name:** `@steprotech/n8n-nodes-composio`. The `@steprotech` part is the npm organization
  that owns the name; the tarball filename drops it and reads
  `steprotech-n8n-nodes-composio-<version>.tgz`, which is expected.
- **Access:** `public`. A scoped package published without it is refused, because npm treats scoped
  packages as private by default.

## After publishing

Tell the maintainer the version that `npm view` reports. Then install it in n8n and run the checks:

1. **Settings > Community Nodes > Install**, enter `@steprotech/n8n-nodes-composio`.
2. Add the credential with the Composio consumer key.
3. Run a Composio node with **Connection > List Connections**, then **Action > Search Actions**.
4. Send back both outputs, or the exact error text.

## When npm refuses

- **403 Forbidden:** the account you are logged in as is not a member of the `steprotech` organization.
  Check with `npm whoami`.
- **402 Payment Required, or "cannot publish private package":** `--access public` was missing.
- **EPUBLISHCONFLICT / "cannot publish over the previously published versions":** the version already
  exists. Bump it.
- **ENEEDAUTH:** not logged in. Run `npm login` again.
- **"seems to be corrupted" followed by ENOENT:** the path is wrong or the file was not fully
  downloaded. Re-check with the `Get-ChildItem` block above, and confirm the hash.
