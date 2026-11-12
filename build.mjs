// 构建：把 src 打包成单个可离线打开的 dist/index.html
// 用法: node build.mjs [--dev]   (--dev 不压缩，便于调试)
import { build } from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const t0 = Date.now();
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !dev,
  target: 'es2020',
  write: false,
  legalComments: 'none',
  define: { __DEV__: dev ? 'true' : 'false' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/style.css', 'utf8');
let html = fs.readFileSync('src/index.html', 'utf8');
html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
if (fs.existsSync('public')) fs.cpSync('public', 'dist', { recursive: true }); // og 图等静态文件
console.log(`built dist/index.html  ${(html.length / 1024).toFixed(0)} KB  in ${Date.now() - t0} ms`);
