import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('demo', 'dist', { recursive: true });
console.log('Built demo → dist');
