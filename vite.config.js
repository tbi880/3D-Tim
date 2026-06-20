import { defineConfig } from 'vite';
import fs from 'fs';
import react from '@vitejs/plugin-react';
import terser from '@rollup/plugin-terser';
import compressPlugin from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';
import { stageOfENV } from './src/Settings';
import { resolve } from 'path';

const ReactCompilerConfig = {
  target: '18', // '17' | '18' | '19'
};

function checkStagePlugin() {
  return {
    name: 'check-stage-of-env',
    config(_, { command }) {
      if (command === 'build' && stageOfENV !== 'prod') {
        throw new Error(
          `❌  stageOfENV = "${stageOfENV}"，Can't build non-prod env！\n` +
          `Please set stageOfENV = "prod" in src/Settings.jsx and try again.`
        );
      }
    }
  };
}

function staticFilePlugin() {
  return {
    name: 'serve-static-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url === '/robots.txt' ||
          req.url === '/sitemap.xml'
        ) {
          res.setHeader(
            'Content-Type',
            req.url.endsWith('.xml')
              ? 'application/xml'
              : 'text/plain'
          );

          res.end(
            fs.readFileSync(`public${req.url}`)
          );

          return;
        }

        next();
      });
    }
  };
}

export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build';

  return {
    publicDir: resolve(__dirname, 'public'),

    server: {
      https: {
        key: fs.readFileSync('localhost-key.pem'),
        cert: fs.readFileSync('localhost.pem'),
      },
      host: true, // 允许局域网访问
    },

    plugins: [
      checkStagePlugin(),
      staticFilePlugin(),
      react({
        babel: {
          plugins: [
            ["babel-plugin-react-compiler", ReactCompilerConfig],
          ],
        },
      }),
      // build 时添加 compression & PWA
      ...(isBuild ? [
        compressPlugin({
          algorithm: 'gzip',
          ext: '.gz',
          threshold: 1025,
          deleteOriginFile: false
        }),
        VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: "Welcome to Tim Bi's world!",
            short_name: 'Tim Bi',
            description: "Welcome to Tim Bi's world!",
            theme_color: '#ffffff',
            start_url: "/",
            display: "standalone",
            scope: "/"
          },
          workbox: {
            navigateFallbackDenylist: [
              /^\/robots\.txt$/,
              /^\/sitemap\.xml$/,
              /^\/Tim_Bi_resume\.pdf$/
            ],
            maximumFileSizeToCacheInBytes: 4_000_000,
            runtimeCaching: [
              {
                urlPattern: /\.(js|css|woff2?|eot|ttf|otf|svg)$/,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'core-assets',
                  expiration: {
                    maxEntries: 50,
                    maxAgeSeconds: 60 * 60 * 24 * 7, // 7 天
                  },
                },
              },
            ],
          },
        })
      ] : [])
    ],

    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/js/[name].js',
          chunkFileNames: 'assets/js/[name].js',
          assetFileNames: ({ name }) => {
            if (!name) return 'assets/[name].[hash][extname]';
            if (/\.(gif|jpe?g|png|svg)$/.test(name)) {
              return 'assets/images/[name].[hash][extname]';
            }
            if (/\.css$/.test(name)) {
              return 'assets/css/[name].[hash][extname]';
            }
            if (/\.(woff2?|eot|ttf|otf)$/.test(name)) {
              return 'assets/fonts/[name].[hash][extname]';
            }
            return 'assets/[name].[hash][extname]';
          },
        },
        plugins: [
          terser({
            compress: {
              drop_console: true,
            },
          }),
        ],
      },
      minify: false,

    },
  };
});
