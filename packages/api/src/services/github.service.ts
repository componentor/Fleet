import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  updatedAt: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: { name: string; email: string; date: string } | null;
  committer: { name: string; email: string; date: string } | null;
  htmlUrl: string;
}

export interface GitHubWebhook {
  id: number;
  url: string;
  active: boolean;
  events: string[];
}

const GITHUB_API = 'https://api.github.com';

export class GitHubService {
  async getRepositories(accessToken: string): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const res = await fetch(
        `${GITHUB_API}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        { headers: this.headers(accessToken) },
      );

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as Array<Record<string, unknown>>;
      if (data.length === 0) break;

      for (const r of data) {
        repos.push({
          id: r['id'] as number,
          name: r['name'] as string,
          fullName: r['full_name'] as string,
          private: r['private'] as boolean,
          defaultBranch: r['default_branch'] as string,
          cloneUrl: r['clone_url'] as string,
          htmlUrl: r['html_url'] as string,
          description: (r['description'] as string) ?? null,
          language: (r['language'] as string) ?? null,
          updatedAt: r['updated_at'] as string,
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return repos;
  }

  async getRepository(
    accessToken: string,
    owner: string,
    repo: string,
  ): Promise<GitHubRepo> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: this.headers(accessToken),
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const r = (await res.json()) as Record<string, unknown>;
    return {
      id: r['id'] as number,
      name: r['name'] as string,
      fullName: r['full_name'] as string,
      private: r['private'] as boolean,
      defaultBranch: r['default_branch'] as string,
      cloneUrl: r['clone_url'] as string,
      htmlUrl: r['html_url'] as string,
      description: (r['description'] as string) ?? null,
      language: (r['language'] as string) ?? null,
      updatedAt: r['updated_at'] as string,
    };
  }

  async getBranches(
    accessToken: string,
    owner: string,
    repo: string,
  ): Promise<GitHubBranch[]> {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`,
      { headers: this.headers(accessToken) },
    );

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map((b) => ({
      name: b['name'] as string,
      commit: b['commit'] as { sha: string; url: string },
      protected: b['protected'] as boolean,
    }));
  }

  async getCommit(
    accessToken: string,
    owner: string,
    repo: string,
    sha: string,
  ): Promise<GitHubCommit> {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`,
      { headers: this.headers(accessToken) },
    );

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const commit = data['commit'] as Record<string, unknown>;
    const author = commit['author'] as Record<string, string> | null;
    const committer = commit['committer'] as Record<string, string> | null;

    return {
      sha: data['sha'] as string,
      message: commit['message'] as string,
      author: author
        ? { name: author['name']!, email: author['email']!, date: author['date']! }
        : null,
      committer: committer
        ? { name: committer['name']!, email: committer['email']!, date: committer['date']! }
        : null,
      htmlUrl: data['html_url'] as string,
    };
  }

  async createWebhook(
    accessToken: string,
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
  ): Promise<GitHubWebhook> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret,
          insecure_ssl: '0',
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      id: data['id'] as number,
      url: data['url'] as string,
      active: data['active'] as boolean,
      events: data['events'] as string[],
    };
  }

  async deleteWebhook(
    accessToken: string,
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<void> {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/hooks/${hookId}`,
      {
        method: 'DELETE',
        headers: this.headers(accessToken),
      },
    );

    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }
  }

  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const sig = Buffer.from(signature);
    const hmac = createHmac('sha256', secret);
    hmac.update(typeof payload === 'string' ? payload : payload);
    const digest = Buffer.from(`sha256=${hmac.digest('hex')}`);

    if (sig.length !== digest.length) return false;
    return timingSafeEqual(sig, digest);
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const clientId = process.env['GITHUB_CLIENT_ID'];
    const clientSecret = process.env['GITHUB_CLIENT_SECRET'];

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub OAuth error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, string>;
    const accessToken = data['access_token'];
    if (!accessToken) {
      throw new Error(`GitHub OAuth error: ${data['error_description'] ?? data['error'] ?? 'unknown'}`);
    }

    return accessToken;
  }

  async getUser(accessToken: string): Promise<{ id: number; login: string; email: string | null; avatarUrl: string; name: string | null }> {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: this.headers(accessToken),
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      id: data['id'] as number,
      login: data['login'] as string,
      email: (data['email'] as string) ?? null,
      avatarUrl: data['avatar_url'] as string,
      name: (data['name'] as string) ?? null,
    };
  }

  /**
   * Clone URL with token for private repos:
   * https://<token>@github.com/owner/repo.git
   */
  getAuthenticatedCloneUrl(accessToken: string, owner: string, repo: string): string {
    return `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`;
  }

  private headers(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

export const githubService = new GitHubService();
