#!/usr/bin/env bash
# Run install.sh end to end in a throwaway systemd container.
# Shared by CI (.github/workflows/ci.yml) and local runs:
#
#   scripts/ci-install-test.sh almalinux:9   false
#   scripts/ci-install-test.sh almalinux:10  true
#   scripts/ci-install-test.sh ubuntu:24.04  false
#
# Needs Docker or Podman (CONTAINER_ENGINE=docker|podman) and a pre-built
# frontend/dist (npm run build). The installer uses BUILD_FRONTEND=false
# so Node.js is not required in the container.
#
# Asserts: install.sh exits 0, the service is active, /health answers on
# the configured scheme, the admin login returns 200, and (GitHub #102)
# openvox_enc is installed under /etc/puppetlabs/bolt/modules as root:bolt
# and is discoverable on the Bolt modulepath. When the openbolt package
# can be installed, `bolt plugin show` must list it and `bolt inventory
# show` must not report Unknown plugin: 'openvox_enc'.
#
# This is the job from issue #48 / PR #49 (@miharp). It is what would have
# caught #44 (TLS health probe) and #45 (missing service group).
set -euo pipefail

IMAGE="${1:?usage: ci-install-test.sh <image> <ssl: true|false>}"
SSL="${2:?usage: ci-install-test.sh <image> <ssl: true|false>}"
case "$SSL" in true|false) ;; *) echo "ssl must be true or false" >&2; exit 2 ;; esac

ENGINE="${CONTAINER_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  if command -v docker >/dev/null 2>&1; then ENGINE=docker
  elif command -v podman >/dev/null 2>&1; then ENGINE=podman
  else echo "neither docker nor podman found" >&2; exit 2
  fi
fi

# Short names such as almalinux:10 resolve on Docker Hub. Podman hosts with
# several unqualified-search-registries would otherwise prompt for one.
# Docker Hub resets (GHA "connection reset by peer" on almalinux:10) are
# retried, then AlmaLinux images fall back to quay.io/almalinuxorg.
_image_candidates() {
    local img="$1"
    case "$img" in
        */*) printf '%s\n' "$img" ;;
        almalinux:*)
            printf '%s\n' "docker.io/library/${img}"
            printf '%s\n' "quay.io/almalinuxorg/${img}"
            ;;
        *) printf '%s\n' "docker.io/library/${img}" ;;
    esac
}

pull_with_retry() {
    local candidate tries
    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        tries=0
        while [ "$tries" -lt 3 ]; do
            tries=$((tries + 1))
            echo "==> pulling ${candidate} (attempt ${tries}/3)"
            if "$ENGINE" pull "$candidate"; then
                PULL_IMAGE="$candidate"
                return 0
            fi
            echo "==> pull failed for ${candidate}; retrying" >&2
            sleep $((tries * 2))
        done
    done < <(_image_candidates "$IMAGE")
    echo "FAIL: could not pull ${IMAGE} (tried Docker Hub and fallbacks)" >&2
    return 1
}

pull_with_retry

REPO=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$REPO/frontend/dist/index.html" ] || {
  echo "frontend/dist missing — run 'npm run build' in frontend/ first" >&2
  exit 2
}

NAME="ovoxgui-install-$$"
FQDN="gui-test.example.com"
STAGE=$(mktemp -d)
cleanup() { "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$STAGE"; }
trap cleanup EXIT

# The installer copies the whole checkout (cp -a), so stage it without
# node_modules and .git to keep the copy small.
tar -C "$REPO" --exclude=./.git --exclude=./frontend/node_modules \
  --exclude=./backend/venv --exclude=./.venv-pip-audit --exclude=./build \
  -cf - . | tar -C "$STAGE" -xf -

case "$IMAGE" in
  ubuntu:*)
    # Stock ubuntu images ship no systemd; bake a minimal init layer.
    RUN_IMAGE="openvox-gui-install-test-$(echo "$IMAGE" | tr ':.' '--')"
    printf '%s\n' \
      "FROM ${PULL_IMAGE}" \
      "ENV DEBIAN_FRONTEND=noninteractive" \
      "RUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv sudo curl openssl python3 python3-venv python3-pip openssh-client passwd >/dev/null && apt-get clean" \
      'CMD ["/lib/systemd/systemd"]' \
      | "$ENGINE" build -q -t "$RUN_IMAGE" - >/dev/null
    INIT=""
    PREP="true"
    PYTHON_BIN="/usr/bin/python3"
    ;;
  *)
    RUN_IMAGE="$PULL_IMAGE"
    INIT="/sbin/init"
    # hostname: 'hostname -f' is used throughout install.sh.
    # python3.12: EL9's default python3 is 3.9 (too old).
    # curl: EL9 images ship curl-minimal, which conflicts with curl.
    PREP="dnf install -y -q sudo openssl diffutils hostname openssh-clients shadow-utils >/dev/null; \
      if [ ! -x /usr/bin/python3.12 ]; then dnf install -y -q python3.12 >/dev/null || dnf install -y -q python3 >/dev/null; fi; \
      command -v curl >/dev/null || dnf install -y -q curl >/dev/null"
    PYTHON_BIN="/usr/bin/python3.12"
    ;;
esac

echo "==> starting ${RUN_IMAGE} as ${NAME}"
# shellcheck disable=SC2086
"$ENGINE" run -d --privileged --name "$NAME" --hostname "$FQDN" \
  -v "$STAGE":/src:ro "$RUN_IMAGE" $INIT >/dev/null
sleep 5

SCHEME=http
[ "$SSL" = true ] && SCHEME=https

"$ENGINE" exec "$NAME" bash -euo pipefail -c "
  $PREP
  if [ ! -x ${PYTHON_BIN} ]; then
    if [ -x /usr/bin/python3.12 ]; then PY=/usr/bin/python3.12
    elif [ -x /usr/bin/python3 ]; then PY=/usr/bin/python3
    else echo 'FAIL: no suitable python3'; exit 1
    fi
  else
    PY=${PYTHON_BIN}
  fi
  echo \"Using Python: \$PY (\$(\"\$PY\" --version 2>&1))\"

  cp -a /src /root/src

  cat > /root/install.conf <<CONF
APP_HOST=0.0.0.0
PYTHON_BIN=\${PY}
AUTH_BACKEND=local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ci-install-secret
SSL_ENABLED=${SSL}
SSL_CERT_PATH=/etc/openvox-gui-ci.crt
SSL_KEY_PATH=/etc/openvox-gui-ci.key
BUILD_FRONTEND=false
INSTALL_NODEJS=false
CONFIGURE_FIREWALL=false
CONFIGURE_SELINUX=false
CONFIGURE_PKG_REPO=false
CONFIGURE_BOLT=true
CONFIGURE_ENC=false
OPENVOX_GUI_DB_BACKEND=sqlite
CONF
  if [ '${SSL}' = true ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=${FQDN}' \
      -keyout /etc/openvox-gui-ci.key -out /etc/openvox-gui-ci.crt 2>/dev/null
    chmod 644 /etc/openvox-gui-ci.key /etc/openvox-gui-ci.crt
  fi

  cd /root/src
  bash install.sh -c /root/install.conf > /root/install.log 2>&1 \
    || { echo 'FAIL: install.sh exited non-zero'; tail -n 80 /root/install.log; exit 1; }
  echo 'PASS: install.sh exit 0'

  [ \"\$(systemctl is-active openvox-gui)\" = active ] \
    || { echo 'FAIL: service not active'; journalctl -u openvox-gui -n 40 --no-pager; tail -n 40 /root/install.log; exit 1; }
  curl -skf ${SCHEME}://127.0.0.1:4567/health | grep -q '\"status\":\"ok\"' \
    || { echo 'FAIL: /health on ${SCHEME}'; journalctl -u openvox-gui -n 40 --no-pager; exit 1; }
  echo 'PASS: service active, /health ok on ${SCHEME}'

  CODE=\$(curl -sk -X POST ${SCHEME}://127.0.0.1:4567/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{\"username\":\"admin\",\"password\":\"ci-install-secret\"}' \
    -o /dev/null -w '%{http_code}')
  [ \"\$CODE\" = 200 ] || { echo \"FAIL: admin login returned \$CODE\"; journalctl -u openvox-gui -n 40 --no-pager; exit 1; }
  echo 'PASS: admin login'

  # GitHub #102. install.sh with CONFIGURE_BOLT=true must leave openvox_enc
  # on the Bolt modulepath. openbolt is not in the base OS repos; try the
  # public OpenVox repo so \`bolt plugin show\` can run. A missing package
  # does not fail the job — the file, owner, and modulepath checks do.
  if [ ! -x /opt/puppetlabs/bolt/bin/bolt ] && ! command -v bolt >/dev/null 2>&1; then
    echo '==> best-effort openbolt install so bolt plugin show can run'
    if command -v dnf >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
      printf '%s\n' \
        '[openvox8]' \
        'name=OpenVox 8 CI' \
        'baseurl=https://yum.voxpupuli.org/openvox8/el/\$releasever/\$basearch' \
        'gpgcheck=0' \
        'enabled=1' \
        > /etc/yum.repos.d/openvox-ci.repo
      if ! timeout 180 dnf install -y openbolt; then
        echo 'WARN: openbolt package not installed; file-level plugin check still required'
      fi
    fi
  fi
  bash /root/src/scripts/install-openvox-enc-plugin.sh --check \
    --install-dir /opt/openvox-gui \
    --bolt-dir /etc/puppetlabs/bolt
  echo 'PASS: openvox_enc installed and resolvable'
"
echo "OK: install.sh on ${IMAGE} (SSL_ENABLED=${SSL}, ${ENGINE})"
