import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { terser } from 'rollup-plugin-terser';
import compressPlugin from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';


// https://vitejs.dev/config/
export default defineConfig({

  plugins: [
    react()
  ],
  build: {
    rollupOptions: {
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
        }),
      ],
    },
  },
})
