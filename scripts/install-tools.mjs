import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Release archives are verified against committed SHA-256 digests before execution.
const platform = `${process.platform}-${process.arch}`;
const tools = [
  { name: 'actionlint', repository: 'rhysd/actionlint', version: '1.7.12',
    archives: {
      'linux-x64': ['linux_amd64', '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'],
      'linux-arm64': ['linux_arm64', '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6'],
      'darwin-arm64': ['darwin_arm64', 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f'],
      'darwin-x64': ['darwin_amd64', '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644'],
    } },
  { name: 'gitleaks', repository: 'gitleaks/gitleaks', version: '8.30.1',
    archives: {
      'linux-x64': ['linux_x64', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
      'linux-arm64': ['linux_arm64', 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'],
      'darwin-arm64': ['darwin_arm64', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
      'darwin-x64': ['darwin_x64', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
    } },
];
const destination = resolve('.cache/tools');
await mkdir(destination, { recursive: true });
for (const tool of tools) {
  const archive = tool.archives[platform];
  if (!archive) throw new Error(`Unsupported tool platform: ${platform}. Use Linux or macOS.`);
  const filename = `${tool.name}_${tool.version}_${archive[0]}.tar.gz`;
  const response = await fetch(`https://github.com/${tool.repository}/releases/download/v${tool.version}/${filename}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Cannot download ${tool.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== archive[1]) throw new Error(`Checksum mismatch: ${tool.name}`);
  const temporary = await mkdtemp(join(tmpdir(), 'ci-tools-'));
  try {
    const path = join(temporary, filename);
    await writeFile(path, bytes);
    execFileSync('tar', ['-xzf', path, '-C', temporary, tool.name]);
    await copyFile(join(temporary, tool.name), join(destination, tool.name));
    await chmod(join(destination, tool.name), 0o755);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`Installed ${tool.name} ${tool.version} (SHA-256 verified)`);
}

