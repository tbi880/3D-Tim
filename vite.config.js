import { defineConfig } from 'vite'
import fs from 'fs';
import react from '@vitejs/plugin-react'
import { terser } from 'rollup-plugin-terser';
import compressPlugin from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';

const ReactCompilerConfig = {
  target: '18' // '17' | '18' | '19'
};

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    https: {
      key: fs.readFileSync('localhost.key'),
      cert: fs.readFileSync('localhost.crt')
    },
    host: true  // 允许局域网访问
  },

  plugins: [
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", ReactCompilerConfig],
        ],
      },
    })
  ],
  build: {
    // 输出目录
    outDir: 'dist',
    assetsDir: 'assets', // 资源文件目录，如图片、CSS 等
    rollupOptions: {
      output: {
        // 配置 JS 文件输出到 assets/js 目录
        entryFileNames: 'assets/js/[name].js',  // 输出主入口文件到 assets/js/
        chunkFileNames: 'assets/js/[name].js',  // 输出动态 import 的 JS 文件到 assets/js/
        assetFileNames: ({ name }) => {
          if (/\.(gif|jpe?g|png|svg)$/.test(name ?? '')) {
            return 'assets/images/[name].[hash][extname]';
          }
          if (/\.css$/.test(name ?? '')) {
            return 'assets/css/[name].[hash][extname]';
          }
          if (/\.(woff2?|eot|ttf|otf)$/.test(name ?? '')) {
            return 'assets/fonts/[name].[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
      plugins: [
        terser({
          compress: {
            // 移除console.* 函数调用
            drop_console: true,
          },
        }),
        compressPlugin({
          // 可以是'gzip'、'brotliCompress' 或 'deflate'
          algorithm: 'gzip',
        }),
        VitePWA({
          registerType: 'autoUpdate',
          // includeAssets: ['favicon.svg', 'robots.txt'], // 在PWA中额外缓存的资源
          manifest: {
            name: 'Welcome to Tim\' world!',
            short_name: 'Tim\'s',
            description: 'Welcome to Tim\' world!',
            theme_color: '#ffffff',
          },
          workbox: {
            maximumFileSizeToCacheInBytes: 4000000, // 将限制增加到 4 MiB
          },
        }),
      ],
    },
  },
})
