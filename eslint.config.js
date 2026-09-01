// Flat ESLint config. No plugins/presets beyond eslint's own built-in rules
// (eslint is the project's only devDependency -- see package.json) so this
// hand-picks a small, high-signal rule set instead of extending a shared
// "recommended" bundle.

// WebExtension APIs (background service worker, content script, popup).
const webextensionGlobals = {
    chrome: 'readonly'
};

// Standard browser globals used across popup/*.js and content_script.js.
const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    URL: 'readonly',
    Blob: 'readonly',
    FileReader: 'readonly',
    MutationObserver: 'readonly',
    Node: 'readonly',
    Event: 'readonly',
    CustomEvent: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    structuredClone: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    alert: 'readonly',
    getComputedStyle: 'readonly'
};

const nodeGlobals = {
    process: 'readonly',
    console: 'readonly'
};

const sharedRules = {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'smart'],
    'no-console': 'off'
};

export default [
    {
        ignores: ['node_modules/**']
    },
    // Extension source: background/, popup/, shared/, content_script.js.
    {
        files: ['background/**/*.js', 'popup/**/*.js', 'shared/**/*.js', 'content_script.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...webextensionGlobals, ...browserGlobals }
        },
        rules: sharedRules
    },
    // Tests run directly under plain node (node:test), not a browser/extension.
    {
        files: ['tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: nodeGlobals
        },
        rules: sharedRules
    },
    // This file itself and any other repo-root tooling config.
    {
        files: ['eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: nodeGlobals
        },
        rules: sharedRules
    }
];
