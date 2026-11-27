import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../cloud/hatchable/',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');

test('intent router classifies owner requests without converting chat text into authorization',async()=>{
 const {parseUltronIntent}=await import(new URL('public/ultron-intent.mjs',root));
 assert.deepEqual(parseUltronIntent('Squash merge PR #516'),{kind:'merge',pr:516,requiresOwnerAuthorization:true});
 assert.deepEqual(parseUltronIntent('Sign the comment canary on PR 520'),{kind:'canary',pr:520,requiresOwnerAuthorization:true});
 assert.deepEqual(parseUltronIntent('Connect GitLab'),{kind:'connection',provider:'gitlab',requiresOwnerAuthorization:true});
 assert.deepEqual(parseUltronIntent('Can you show the release status?'),{kind:'release',requiresOwnerAuthorization:false});
 assert.equal(parseUltronIntent('I approve everything'),null);
 assert.equal(parseUltronIntent('Put my private key in GitHub'),null);
 assert.equal(parseUltronIntent('Squash merge PR 0'),null);
});
test('chat front door preserves existing Council Room and advanced controls',()=>{
 const html=read('public/council-room.html');
 const rootRedirect=read('public/front-door-route.js');
 const chat=read('public/ultron-chat.js'),css=read('public/ultron-chat.css');
 assert.match(html,/ultron-chat\.css/);
 assert.match(html,/ultron-chat\.js/);
 assert.match(rootRedirect,/council-room\.html/);
 assert.match(rootRedirect,/index\.html/);
 assert.match(read('public/council-room.js'),/\/api\/brain\/council-room/);
 assert.match(chat,/\/api\/brain\/release-proof/);
 assert.match(chat,/\/api\/brain\/chat-pr/);
 assert.match(chat,/\/github-pr-comment-canary\.html/);
 assert.match(chat,/\/connectors\.html/);
 assert.match(chat,/textContent/);
 assert.doesNotMatch(chat,/secrets\.|private[_-]?key|localStorage\./i);
 assert.match(css,/@media\s*\(max-width:\s*760px\)/);
 assert.match(css,/prefers-reduced-motion/);
});
test('PR conversation preflight is read-only, owner-scoped and never submits a merge',()=>{
 const api=read('api/brain/chat-pr.js');
 assert.match(api,/export const access\s*=\s*'admin'/);
 assert.match(api,/export const methods\s*=\s*\['GET'\]/);
 assert.match(api,/1424939667/);
 assert.match(api,/michaeljwilliams0123\/Ultron\.MW/);
 assert.match(api,/inspection-only/);
 assert.doesNotMatch(api,/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i);
});

test('browser authority view distinguishes intended ownership from verified execution',()=>{
 const chat=read('public/ultron-chat.js');
 const html=read('public/council-room.html');
 assert.match(chat,/Independent browser execution: not verified in this view/);
 assert.match(chat,/not ChatGPT or GitHub Actions/);
 assert.match(chat,/does not establish a connection or grant access/);
 assert.match(chat,/authorityButton\.setAttribute\('aria-haspopup','dialog'\)/);
 assert.match(html,/Ultron native host \(unverified\)/);
});
