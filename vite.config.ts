import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
  },
  server: {
    port: 8000,
    open: false,
    // 开发模式直接代理教务网，`npm run dev` 即可完整调试登录与数据拉取，
    // 不再需要先 build 再跑 dev_server.py
    proxy: {
      '/jsxsd': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        headers: {
          Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/',
          Origin: 'https://xjwis.ynufe.edu.cn',
        },
      },
      // 公告附件由富文本编辑器上传，落在 /ewebeditor/ 而非 /jsxsd/ 下，
      // 不代理这些前缀会导致点击附件 404。
      '/ewebeditor': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        headers: { Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/' },
      },
      '/uploadfiles': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        headers: { Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/' },
      },
    },
  },
});
