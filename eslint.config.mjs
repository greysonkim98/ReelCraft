import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'frontend/public/**',
      'frontend/out/**',
      'frontend/next-env.d.ts',
      'frontend/next.config.js',
      'frontend/scripts/**',
      '.scratch/**',
      'scripts/audit/**',
      'ReelCraft/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
