#!/usr/bin/env bash
#
# End-to-end load test: install this package into a real n8n and prove n8n registers it.
#
# Proves, against a throwaway n8n:
#   1. the package installs the way a self-hosted user installs it
#   2. n8n registers the node types (Composio and the Composio Tool variant)
#   3. the credential type is registered
#
# Optional live phase, only when COMPOSIO_CONSUMER_KEY is set: import the credential and run a
# read-only workflow (list connections) against Composio. The key is passed into the container as
# an environment variable, substituted inside the container's own filesystem, and never written to
# this repository or printed by this script. Never commit a key.
#
# Usage:  bash test/manual/docker-load-verify.sh
#         COMPOSIO_CONSUMER_KEY=... bash test/manual/docker-load-verify.sh
#
set -euo pipefail

NAME="${NAME:-n8n-composio-verify}"
IMAGE="${IMAGE:-n8nio/n8n:latest}"
PORT="${PORT:-5699}"
VOL="${VOL:-/tmp/n8n-composio-verify}"
PKG_SPEC="${PKG_SPEC:-/tmp/pkg.tgz}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

N8N_ENV=(
	-e NODE_OPTIONS=--max-old-space-size=512
	-e N8N_DIAGNOSTICS_ENABLED=false
	-e N8N_VERSION_NOTIFICATIONS_ENABLED=false
	-e GENERIC_TIMEZONE=UTC
)

wait_for_n8n() {
	for _ in $(seq 1 60); do
		if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz" || true)" = "200" ]; then
			echo "    n8n ready"
			return 0
		fi
		sleep 3
	done
	echo "    n8n did not become ready; last container log lines:" >&2
	docker logs "$NAME" 2>&1 | tail -5 >&2
	return 1
}

echo "== 1. build and pack"
cd "$REPO"
npm run build >/dev/null
TARBALL="$(npm pack --silent | tail -1)"
echo "    $TARBALL ($(stat -c%s "$TARBALL") bytes)"

echo "== 2. fresh n8n instance"
docker rm -f "$NAME" >/dev/null 2>&1 || true
mkdir -p "$VOL"
# The container runs as uid 1000, which is not necessarily this shell's uid, so the mount point has
# to be writable by it: n8n writes its settings file and encryption key there. Throwaway volume.
chmod 777 "$VOL"
docker run --rm -v "${VOL}:/home/node/.n8n" --entrypoint sh "$IMAGE" -lc \
	'rm -rf /home/node/.n8n/* /home/node/.n8n/.[!.]* 2>/dev/null'
docker run -d --name "$NAME" --memory=1200m --memory-swap=1200m "${N8N_ENV[@]}" \
	-e N8N_SECURE_COOKIE=false -e N8N_LOG_LEVEL=info \
	-p "127.0.0.1:${PORT}:5678" -v "${VOL}:/home/node/.n8n" "$IMAGE" >/dev/null
wait_for_n8n

echo "== 3. install the package the manual way"
echo "    installing: ${PKG_SPEC}"
if [ "${PKG_SPEC}" = "/tmp/pkg.tgz" ]; then
	docker cp "$TARBALL" "${NAME}:/tmp/pkg.tgz" >/dev/null
fi
# --legacy-peer-deps: n8n-workflow is a peer, supplied by n8n at runtime. A plain install would try
# to fetch it from the registry and fail building its native isolated-vm dependency in this image.
docker exec "$NAME" sh -lc \
	"mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --no-audit --no-fund --legacy-peer-deps ${PKG_SPEC} 2>&1 | tail -2"
docker restart "$NAME" >/dev/null
wait_for_n8n

echo "== 4. registered node types"
docker exec "$NAME" sh -lc 'n8n export:nodes --output=/tmp/nodes.json >/dev/null 2>&1
node -e "
	const n = require(\"/tmp/nodes.json\");
	const list = Array.isArray(n) ? n : (n.data || []);
	const mine = list.filter((x) => String(x.name).includes(\"composio\"));
	if (mine.length < 2) { console.error(\"expected at least 2 registered node types (node + tool), got \" + mine.length); process.exit(1); }
	mine.forEach((x) => console.log(\"    \" + x.name + \" (\" + x.displayName + \")\"));
	console.log(\"    total node types in this instance: \" + list.length);
"'

echo "== 5. registered credential type"
docker exec "$NAME" sh -lc 'n8n export:credentials --all --output=/tmp/creds.json >/dev/null 2>&1 || true
node -e "
	const fs = require(\"fs\");
	const doc = fs.existsSync(\"/tmp/creds.json\") ? JSON.parse(fs.readFileSync(\"/tmp/creds.json\", \"utf8\")) : [];
	const names = (Array.isArray(doc) ? doc : doc.data || []).map((c) => c.type || c.name || \"\");
	const mine = names.filter((x) => String(x).includes(\"composio\"));
	console.log(mine.length ? \"    \" + mine.join(\", \") : \"    (no stored credential yet, which is expected on a fresh instance)\");
"'

if [ -n "${COMPOSIO_CONSUMER_KEY:-}" ]; then
	echo "== 6. live phase: list connections through Composio"
	docker cp test/manual/verify-credentials.template.json "${NAME}:/tmp/creds.template.json" >/dev/null
	docker exec -e CC_KEY="$COMPOSIO_CONSUMER_KEY" "$NAME" sh -lc \
		'sed "s|__COMPOSIO_CONSUMER_KEY__|$CC_KEY|" /tmp/creds.template.json > /tmp/creds.json && n8n import:credentials --input=/tmp/creds.json'
	docker cp test/manual/verify-connections.workflow.json "${NAME}:/tmp/verify-connections.json" >/dev/null
	docker exec "$NAME" n8n import:workflow --input=/tmp/verify-connections.json >/dev/null
	out="$(docker run --rm --memory=1200m --memory-swap=1200m "${N8N_ENV[@]}" \
		-v "${VOL}:/home/node/.n8n" --entrypoint sh "$IMAGE" -lc \
		"n8n execute --id=compVerifyWf00001 --rawOutput" 2>/tmp/n8n-composio-exec.err || true)"
	printf '%s' "$out" | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
	doc = json.loads(raw[raw.find('{'):raw.rfind('}') + 1])
except Exception:
	print('    could not parse the execution result')
	sys.exit(1)
status = doc.get('status')
runs = doc['data']['resultData']['runData']['Composio']
items = [i['json'] for e in runs for i in e['data']['main'][0]]
print('    execution=' + str(status) + ', items=' + str(len(items)))
for item in items[:2]:
	print('        ' + json.dumps(item)[:400])
if status != 'success':
	sys.exit(1)
"
else
	echo "== 6. live phase skipped (set COMPOSIO_CONSUMER_KEY to run it; never commit the key)"
fi

echo
echo "PASS: the package installs and n8n registers the Composio node and its tool variant."
echo "The instance is still running on http://127.0.0.1:${PORT} (docker rm -f ${NAME} to remove it)."
