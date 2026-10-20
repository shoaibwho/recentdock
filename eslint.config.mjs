// SPDX-License-Identifier: GPL-3.0-or-later
export default [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                global: 'readonly', console: 'readonly', print: 'readonly', printerr: 'readonly',
                log: 'readonly', logError: 'readonly', imports: 'readonly', ARGV: 'readonly',
                TextEncoder: 'readonly', TextDecoder: 'readonly', globalThis: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            'no-undef': 'error',
            'prefer-const': 'error',
            'eqeqeq': ['error', 'always'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
        },
    },
];
