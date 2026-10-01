import { defineConfig } from 'vite';

// base: './' 便于直接部署到 GitHub Pages / Cloudflare Pages / Vercel / Netlify 子路径
export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
