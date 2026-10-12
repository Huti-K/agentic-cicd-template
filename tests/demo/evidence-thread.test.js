import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../demo/src/platform-core.js';

const at='2026-10-12T00:19:55.548Z';
const comment={authorId:'ai',kind:'evidence',body:'24 browser scenarios passed.',createdAt:at};
const job={id:'evidence-1',kind:'evidence',status:'succeeded',summary:comment.body,updatedAt:at,evidence:[{url:'https://github.com/owner/repo/actions/runs/1/artifacts/2'}]};

test('discussion evidence is attached to its actual completion comment',()=>{
  assert.equal(typeof core.commentEvidence,'function','Discussion needs the completed evidence run and recording links.');
  assert.equal(core.commentEvidence(comment,[job]),job);
  assert.equal(core.commentEvidence({...comment,authorId:'huti'},[job]),null);
  assert.equal(core.commentEvidence({...comment,createdAt:'2026-10-12T01:00:00.000Z'},[job]),null);
  assert.equal(core.commentEvidence({...comment,body:'A different run'},[job]),null);
  assert.equal(core.commentEvidence(comment,[{...job,kind:'implement'}]),null);
  assert.equal(core.commentEvidence(comment,[{...job,status:'running'}]),null);
});

test('failed evidence links to its own run without borrowing previous recordings',()=>{
  assert.equal(typeof core.commentEvidence,'function');
  const failed={...job,id:'failed',status:'failed',summary:'Browser assertions failed.',updatedAt:'2026-10-12T01:00:00.000Z',evidence:[]};
  assert.equal(core.commentEvidence({authorId:'ai',kind:'agent',body:failed.summary,createdAt:failed.updatedAt},[job,failed]),failed);
  assert.equal(core.commentEvidence(comment,[]),null);
});
