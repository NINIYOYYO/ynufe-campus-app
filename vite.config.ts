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
    host: true,
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
        // 教务网把 JSESSIONID 下发为 Path=/jsxsd，浏览器据此不会在请求
        // /ewebeditor/uploadfile/*.doc（公告附件）时携带它，服务端只看到半个
        // 身份，返回「非法访问文件！」。开发代理下放开作用域，让附件也能带上会话。
        cookiePathRewrite: '/',
        headers: {
          Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/',
          Origin: 'https://xjwis.ynufe.edu.cn',
        },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            // 404 或非登录错误响应如果带有 Set-Cookie，坚决拦截剔除，防止浏览器底层 Cookie Jar 被污染
            const isLoginOrVerify = req.url && (req.url.includes('/xk/LoginToXk') || req.url.includes('verifycode.servlet'));
            if ((proxyRes.statusCode && proxyRes.statusCode >= 400) || (!isLoginOrVerify && proxyRes.statusCode === 200 && proxyRes.headers['set-cookie'] && !req.url?.includes('login.jsp'))) {
              if (proxyRes.headers['set-cookie']) {
                delete proxyRes.headers['set-cookie'];
              }
            }
          });
        },
      },
      // 公告附件由富文本编辑器上传，落在 /ewebeditor/、/uploadfiles/ 等路径下，
      // 必须开启 cookiePathRewrite: '/' 与 autoRewrite，并且坚决剥离任何 Set-Cookie。
      '/ewebeditor': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        autoRewrite: true,
        protocolRewrite: 'http',
        cookieDomainRewrite: '',
        cookiePathRewrite: '/',
        headers: { Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/' },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['set-cookie']) {
              delete proxyRes.headers['set-cookie'];
            }
          });
        },
      },
      '/uploadfiles': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        autoRewrite: true,
        protocolRewrite: 'http',
        cookieDomainRewrite: '',
        cookiePathRewrite: '/',
        headers: { Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/' },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['set-cookie']) {
              delete proxyRes.headers['set-cookie'];
            }
          });
        },
      },
      '/uploadfile': {
        target: 'https://xjwis.ynufe.edu.cn',
        changeOrigin: true,
        secure: false,
        autoRewrite: true,
        protocolRewrite: 'http',
        cookieDomainRewrite: '',
        cookiePathRewrite: '/',
        headers: { Referer: 'https://xjwis.ynufe.edu.cn/jsxsd/' },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['set-cookie']) {
              delete proxyRes.headers['set-cookie'];
            }
          });
        },
      },
    },
  },
});
