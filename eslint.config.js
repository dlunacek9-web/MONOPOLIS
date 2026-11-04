import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pravidla hry nesmí záviset na grafice, UI, síti ani na prohlížeči.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['three', '**/ui/**', '**/render/**', '**/net/**', '**/bots/**'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'V core používej seedované RNG.' },
      ],
    },
  },
);
