import { logger } from './logger.js';

export interface ImageRef {
  registry: string;
  name: string;
  tag: string;
}

/**
 * Parse a Docker image reference into its components.
 * Examples:
 *   "nginx" → { registry: "docker.io", name: "library/nginx", tag: "latest" }
 *   "nginx:1.25" → { registry: "docker.io", name: "library/nginx", tag: "1.25" }
 *   "myorg/myapp:v2" → { registry: "docker.io", name: "myorg/myapp", tag: "v2" }
 *   "ghcr.io/org/app:latest" → { registry: "ghcr.io", name: "org/app", tag: "latest" }
 *   "registry.example.com:5000/app:1.0" → { registry: "registry.example.com:5000", name: "app", tag: "1.0" }
 */
export function parseImageRef(image: string): ImageRef {
  // Strip digest
  let ref = image.split('@')[0]!;

  // Extract tag
  let tag = 'latest';
  // For images with port in registry (e.g. registry:5000/app:tag), only split on last colon after the name part
  const slashIdx = ref.indexOf('/');
  const colonAfterName = ref.lastIndexOf(':');
  if (colonAfterName > slashIdx) {
    tag = ref.slice(colonAfterName + 1);
    ref = ref.slice(0, colonAfterName);
  } else if (slashIdx === -1 && ref.includes(':')) {
    // Simple case like "nginx:1.25"
    const parts = ref.split(':');
    tag = parts[1]!;
    ref = parts[0]!;
  }

  const parts = ref.split('/');

  // If first part contains a dot or colon, it's a registry hostname
  if (parts.length >= 2 && (parts[0]!.includes('.') || parts[0]!.includes(':'))) {
    return {
      registry: parts[0]!,
      name: parts.slice(1).join('/'),
      tag,
    };
  }

  // Docker Hub — add library/ prefix for official images
  const name = parts.length === 1 ? `library/${parts[0]}` : parts.join('/');
  return { registry: 'docker.io', name, tag };
}

/**
 * Get the Docker Registry V2 API base URL for a registry.
 */
function getRegistryApiUrl(registry: string): string {
  if (registry === 'docker.io') {
    return 'https://registry-1.docker.io';
  }
  // Assume HTTPS for all other registries
  return `https://${registry}`;
}

/**
 * Get a Docker Hub token for pulling manifests (anonymous or authenticated).
 */
async function getDockerHubToken(
  name: string,
  auth?: { username: string; password: string },
): Promise<string> {
  const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${name}:pull`;

  const headers: Record<string, string> = {};
  if (auth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Docker Hub auth failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { token: string };
    return data.token;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Get the current digest for an image:tag from a Docker V2 registry.
 * Returns the Docker-Content-Digest header value, or null if the image/tag doesn't exist.
 */
export async function getImageDigest(
  imageRef: ImageRef,
  auth?: { username: string; password: string },
): Promise<string | null> {
  const apiUrl = getRegistryApiUrl(imageRef.registry);
  const manifestUrl = `${apiUrl}/v2/${imageRef.name}/manifests/${imageRef.tag}`;

  const headers: Record<string, string> = {
    'Accept': [
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.oci.image.index.v1+json',
    ].join(', '),
  };

  try {
    // Docker Hub requires token-based auth
    if (imageRef.registry === 'docker.io') {
      const token = await getDockerHubToken(imageRef.name, auth);
      headers['Authorization'] = `Bearer ${token}`;
    } else if (auth) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(manifestUrl, {
      method: 'HEAD',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      logger.warn({ status: res.status, registry: imageRef.registry, image: imageRef.name, tag: imageRef.tag },
        'Registry manifest HEAD returned unexpected status');
      return null;
    }

    return res.headers.get('docker-content-digest');
  } catch (err) {
    logger.error({ err, registry: imageRef.registry, image: imageRef.name, tag: imageRef.tag },
      'Failed to fetch image digest from registry');
    return null;
  }
}
