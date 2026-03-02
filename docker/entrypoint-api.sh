#!/bin/sh
set -e

# Dynamically grant the fleet user access to the Docker socket.
# The socket's GID on the host varies across distros, so we detect it
# at runtime and create/reuse a matching group inside the container.
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null)
  if [ -n "$DOCKER_GID" ] && [ "$DOCKER_GID" != "0" ]; then
    addgroup -g "$DOCKER_GID" -S docker 2>/dev/null || true
    addgroup fleet docker 2>/dev/null || true
  else
    # Socket owned by root group — add fleet to root group
    addgroup fleet root 2>/dev/null || true
  fi
fi

# Ensure bind-mounted directories are writable by the fleet user
for dir in /srv/nfs/uploads /srv/nfs/backups /srv/nfs/log-archives /app/data; do
  [ -d "$dir" ] && chown fleet:fleet "$dir" 2>/dev/null || true
done

exec su-exec fleet "$@"
