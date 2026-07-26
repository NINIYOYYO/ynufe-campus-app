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
        // 登录成功后教务网会 302 到绝对地址 http://xjwis.ynufe.edu.cn/jsxsd/...，
        // 若原样透传，浏览器会跨域跟跳并被 CORS 拦截，导致「密码正确却登录失败」。
        // autoRewrite 把 Location 中的主机改写回当前开发服务器。
        autoRewrite: true,
        protocolRewrite: 'http',
        cookieDomainRewrite: '',
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
