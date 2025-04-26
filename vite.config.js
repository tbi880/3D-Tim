import { defineConfig } from 'vite'
import fs from 'fs';
import react from '@vitejs/plugin-react'
import { terser } from 'rollup-plugin-terser';
import compressPlugin from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';
import { stageOfENV } from './src/Settings';

const ReactCompilerConfig = {
  target: '18' // '17' | '18' | '19'
};

function checkStagePlugin() {
  return {
    name: 'check-stage-of-env',
    config(_, { command }) {
      if (command === 'build' && stageOfENV !== 'prod') {
        throw new Error(
          `❌  stageOfENV = "${stageOfENV}"，Can't build non Prod env！\n` +
          `Please set stageOfENV = "prod" in src/Settings.jsx and try again.`
        );
      }
    }
  };
}


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
    checkStagePlugin(), // 检查 stageOfENV 是否为 prod
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
            name: 'Welcome to Tim Bi\'s world!',
            short_name: 'Tim Bi',
            description: 'Welcome to Tim Bi\'s world!',
            theme_color: '#ffffff',
            start_url: "/",
            display: "standalone",
            scope: "/"
          },
          workbox: {
            maximumFileSizeToCacheInBytes: 4000000, // 将限制增加到 4 MiB
            runtimeCaching: [
              {
                urlPattern: /\.(js|css|woff2|svg)$/, // 预缓存 JavaScript、CSS、字体、SVG 图标
                handler: "CacheFirst",
                options: {
                  cacheName: "core-assets",
                  expiration: {
                    maxEntries: 50, // 最多缓存 50 个核心资源
                    maxAgeSeconds: 60 * 60 * 24 * 7, // 7 天自动清理
                  }
                }
              }
            ]
          }
        }),
      ],
    },
  },
})
