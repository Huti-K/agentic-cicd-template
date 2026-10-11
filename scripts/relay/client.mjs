const MAX_RESPONSE = 2_000_000;
export async function jsonRequest(url, { token, method = 'GET', body, fetcher = fetch } = {}) {
  const response = await fetcher(url, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { const error = new Error(`${method} ${new URL(url).pathname} failed (${response.status}).`); error.status = response.status; throw error; }
  if (response.status === 204) return null;
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE) throw new Error('API response exceeds limit.');
  return raw ? JSON.parse(raw) : null;
}
export function clients(env = process.env) {
  const platform = new URL(env.RELAY_URL);
  if (platform.protocol !== 'https:' || platform.username || platform.password || platform.search || platform.hash || !env.RELAY_CALLBACK_SECRET) throw new Error('Missing or invalid trusted Relay configuration.');
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(env.GITHUB_REPOSITORY) || !/^\d+$/.test(env.GITHUB_RUN_ID)) throw new Error('Invalid GitHub run context.');
  return {
    platform: (path, body) => jsonRequest(new URL(path, platform), { token: env.RELAY_CALLBACK_SECRET, method: body === undefined ? 'GET' : 'POST', body }),
    github: (path, body, method = body === undefined ? 'GET' : 'POST') => jsonRequest(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, { token: env.GH_TOKEN, method, body }),
  };
}
