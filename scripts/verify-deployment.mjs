import { setTimeout } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyDeployment({ url, sha, attempts = 12, delay = 10_000, fetcher = fetch, sleep = setTimeout }) {
  if (!/^https?:\/\//.test(url ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Supply a site URL and a full commit SHA.');
  const base = new URL(url.endsWith('/') ? url : url + '/');
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(new URL(`build.json?commit=${sha}&attempt=${attempt}`, base), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`build.json returned HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.sha !== sha) throw new Error('Pages is still serving a different commit.');
      for (const asset of ['index.html', 'src/app.js', 'styles.css', 'pipeline.html']) {
        const assetResponse = await fetcher(new URL(asset, base), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!assetResponse.ok || !(await assetResponse.text()).trim()) throw new Error(`Missing deployed asset: ${asset}`);
      }
      console.log(`Deployment verified: ${base.href} serves ${sha}`);
      return manifest;
    } catch (error) {
      failure = error;
      console.log(`Deployment check ${attempt}/${attempts}: ${error.message}`);
      if (attempt < attempts) await sleep(delay);
    }
  }
  throw new Error(`Deployment verification failed: ${failure.message}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await verifyDeployment({ url: process.env.DEPLOYMENT_URL, sha: process.env.EXPECTED_SHA });
}

