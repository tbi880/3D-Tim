module.exports = {
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended-latest'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  settings: {
    react: { version: '18.2.0' },
  },
  plugins: [
    'react-refresh',
    'react-hooks',
  ],
  rules: {
    'react-refresh/only-export-components': 'warn',
    'react-hooks/react-compiler': 'error',

  },
}
