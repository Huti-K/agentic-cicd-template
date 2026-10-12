import test from 'node:test';
import assert from 'node:assert/strict';
import { copyTicketLink } from '../../demo/src/platform-core.js';

test('ticket links use the workspace origin and pathname on local and deployed hosts', async () => {
  for (const [href, expected] of [
    ['http://localhost:4173/#overview', 'http://localhost:4173/#ticket/RLY-1'],
    ['https://relay.example.test/workspace/index.html?filter=old#ticket/RLY-99', 'https://relay.example.test/workspace/index.html#ticket/RLY-1'],
    ['https://relay.example.test//workspace/?old=filter', 'https://relay.example.test//workspace/#ticket/RLY-1'],
  ]) {
    const writes=[], messages=[];
    const clipboard={writeText(value){assert.equal(this,clipboard);writes.push(value);return Promise.resolve();}};
    assert.equal(await copyTicketLink('RLY-1',{location:new URL(href),clipboard,announce:(...args)=>messages.push(args)}),true);
    assert.deepEqual(writes,[expected]);
    assert.deepEqual(messages.at(-1),['Ticket link copied for RLY-1.']);
  }
});

test('clipboard writing starts at activation and success waits for resolution, retaining the captured ticket', async () => {
  const location=new URL('https://relay.example.test/relay/#ticket/RLY-1'),writes=[],messages=[];
  let resolveWrite;
  const pending=copyTicketLink('RLY-1',{location,clipboard:{writeText:value=>{writes.push(value);return new Promise(resolve=>{resolveWrite=resolve;});}},announce:message=>messages.push(message)});
  assert.deepEqual(writes,['https://relay.example.test/relay/#ticket/RLY-1']);
  assert.deepEqual(messages,['Copying ticket link for RLY-1…']);
  location.hash='ticket/RLY-2';
  resolveWrite();
  assert.equal(await pending,true);
  assert.equal(messages.at(-1),'Ticket link copied for RLY-1.');
  await copyTicketLink('RLY-2',{location,clipboard:{writeText:async value=>writes.push(value)}});
  assert.equal(writes.at(-1),'https://relay.example.test/relay/#ticket/RLY-2');
});

test('missing support, rejected writes and synchronous clipboard errors explain manual copying and permit retry', async () => {
  const location=new URL('https://relay.example.test/#ticket/RLY-1');
  for (const clipboard of [null, {}, {writeText:null}, {writeText:async()=>{throw new Error('Permission denied');}}, {writeText:()=>{throw new Error('Clipboard unavailable');}}]) {
    const messages=[];
    assert.equal(await copyTicketLink('RLY-1',{location,clipboard,announce:(...args)=>messages.push(args)}),false);
    assert.deepEqual(messages.at(-1),['Automatic copying is unavailable or was denied. Copy the ticket URL from the address bar instead.',true]);
    assert.equal(messages.some(([message])=>message.includes('copied')),false);
    let copied;
    assert.equal(await copyTicketLink('RLY-1',{location,clipboard:{writeText:async value=>{copied=value;}}}),true);
    assert.equal(copied,'https://relay.example.test/#ticket/RLY-1');
  }
});
