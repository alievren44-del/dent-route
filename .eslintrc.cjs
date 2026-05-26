/* eslint-disable */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  ignorePatterns: ['dist', 'build', 'node_modules', '*.config.ts', '*.config.js', '*.d.ts', 'scripts/'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  settings: {
    react: { version: 'detect' },
  },
  plugins: ['react-refresh'],
  rules: {
    // No any — strict
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    'react/prop-types': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  },
};
