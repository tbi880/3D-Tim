import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The site is built with the React Compiler (vite.config.js). It caches a handler such as
 * `() => use(page.before)` and, to know when to make a new one, reads `page.before` itself on
 * every render - also on the renders where `page` is still null and the handler would never
 * have run. That took the whole page down when a lobby was opened (white screen, "Cannot read
 * properties of null (reading 'before')"), and only in a build that runs the compiler.
 *
 * This compiles every component of the game the way the build does and looks for that shape:
 * a `useState(null)` value whose property a handler reads, and the compiler reads during
 * render, with no `if (!value) return` before the handler.
 */

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** As in vite.config.js. */
const COMPILER = ['babel-plugin-react-compiler', { target: '18' }];

function componentFiles(dir, found = []) {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) componentFiles(path, found);
        else if (entry.name.endsWith('.jsx')) found.push(path);
    }
    return found;
}

/** The `value.property` reads the compiler makes during render to decide if a cached thing is stale. */
function renderReads(source, filename) {
    const { code } = babel.transformSync(source, {
        filename, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [COMPILER],
    });
    const reads = new Set();
    for (const match of code.matchAll(/\$\[\d+\] !== ([A-Za-z_$][\w$]*)\.([\w$]+)/g)) reads.add(`${match[1]}.${match[2]}`);
    return reads;
}

/** `const [value] = useState(null)` (or with nothing in it). */
function startsEmpty(binding) {
    const declarator = binding.path.node;
    if (declarator.type !== 'VariableDeclarator' || declarator.id.type !== 'ArrayPattern') return false;
    if (declarator.id.elements[0] !== binding.identifier) return false;
    const call = declarator.init;
    if (call?.type !== 'CallExpression' || call.callee.name !== 'useState') return false;
    const first = call.arguments[0];
    return !first || first.type === 'NullLiteral' || (first.type === 'Identifier' && first.name === 'undefined');
}

/** True when the component returns early on `name` before the statement `path` is in. */
function guardedBefore(path, component, name) {
    const statement = path.findParent((parent) => parent.parentPath?.parentPath === component);
    for (const earlier of statement?.getAllPrevSiblings() ?? []) {
        if (!earlier.isIfStatement()) continue;
        let tested = false;
        let returns = false;
        earlier.get('test').traverse({ Identifier(id) { if (id.node.name === name) tested = true; } });
        if (earlier.get('test').isIdentifier({ name })) tested = true;
        earlier.get('consequent').traverse({ ReturnStatement() { returns = true; } });
        if (earlier.get('consequent').isReturnStatement()) returns = true;
        if (tested && returns) return true;
    }
    return false;
}

/** Every place where a render would read a property of a still-empty `useState` value. */
function unsafeReads(source, filename) {
    const reads = renderReads(source, filename);
    const found = [];
    traverse(parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
        MemberExpression(path) {
            const { object, property, optional, computed } = path.node;
            if (optional || computed || object.type !== 'Identifier' || !reads.has(`${object.name}.${property.name}`)) return;
            const binding = path.scope.getBinding(object.name);
            if (!binding || !startsEmpty(binding)) return;
            const component = binding.scope.path;
            const handler = path.getFunctionParent();
            if (!component.isFunction() || !handler || handler === component) return;
            if (guardedBefore(handler, component, object.name)) return;
            found.push(`${filename}:${path.node.loc.start.line} ${object.name}.${property.name}`);
        },
    });
    return found;
}

test('the check itself sees the mistake, and not the two safe ways to write it', () => {
    const component = (body) => `
        import { useState } from 'react';
        export default function Lobby({ session }) {
            const [page, setPage] = useState(null);
            ${body}
            return <button onClick={cancel}>{page ? 'open' : 'closed'}</button>;
        }`;
    assert.deepEqual(
        unsafeReads(component('const cancel = () => { session.restore(page.before); setPage(null); };'), 'Lobby.jsx'),
        ['Lobby.jsx:5 page.before'],
    );
    assert.deepEqual(unsafeReads(component('const cancel = () => { session.restore(page); setPage(null); };'), 'Lobby.jsx'), []);
    assert.deepEqual(
        unsafeReads(component('if (!page) return null;\nconst cancel = () => { session.restore(page.before); setPage(null); };'), 'Lobby.jsx'),
        [],
    );
});

test('no component reads a property of a still-empty useState value while rendering', () => {
    const found = [...componentFiles('src/game'), 'src/urls/EchoesOfDawn.jsx']
        .flatMap((file) => unsafeReads(readFileSync(join(ROOT, file), 'utf8'), file));
    assert.deepEqual(found, [], 'keep the value itself in the state (not an object around it), or return early before the handler');
});
