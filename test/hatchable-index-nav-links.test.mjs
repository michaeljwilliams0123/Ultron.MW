import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync('cloud/hatchable/public/index.html','utf8');

test('Cloud controls nav keeps the Local workbooks link (restored from v87)',()=>{
 const nav=html.slice(html.indexOf('<nav class="unified-nav"'),html.indexOf('</nav>',html.indexOf('<nav class="unified-nav"')));
 assert.match(nav,/<a href="\/local-workbooks\.html">Local workbooks<\/a>/);
 assert.match(nav,/<a href="\/" aria-current="page">Cloud controls<\/a>/);
 assert.match(nav,/<a href="\/council-room\.html">Council room · start here<\/a>/);
});

test('Cloud controls links to read-only connector readiness (restored from v87)',()=>{
 assert.match(html,/<a href="\/connectors\.html">View connector readiness<\/a> \(read-only\)\./);
});
