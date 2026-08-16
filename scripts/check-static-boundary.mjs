import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const forbidden = ['app/api', 'pages/api', 'middleware.ts', 'middleware.js'];
for (const entry of forbidden) if (existsSync(path.join(root, entry))) throw new Error(`Static boundary violation: ${entry}`);
function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
for (const file of walk(path.join(root, 'app')).concat(walk(path.join(root, 'web', 'src')))) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (/['"]use server['"]/.test(source) || /fetch\s*\(/.test(source)) throw new Error(`Client-only boundary violation: ${path.relative(root, file)}`);
}
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const dependency of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
  if (/express|fastify|koa|multer|formidable|fastapi/i.test(dependency)) throw new Error(`Server/upload dependency is not allowed: ${dependency}`);
}
if (existsSync(path.join(root, 'out'))) {
  for (const file of walk(path.join(root, 'out'))) {
    if (/\/api\/|\\api\\|route|server/i.test(path.relative(root, file))) throw new Error(`Static artifact contains server route: ${path.relative(root, file)}`);
  }
}
if (!existsSync(path.join(root, 'next.config.mjs'))) throw new Error('Missing Next static configuration.');
const nextConfig = readFileSync(path.join(root, 'next.config.mjs'), 'utf8');
if (!/output:\s*['"]export['"]/.test(nextConfig)) throw new Error('Next config must use output: export.');
console.log('Static client-only boundary passed.');
