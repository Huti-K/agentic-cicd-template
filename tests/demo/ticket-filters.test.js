import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { STATUS, PRIORITY } from '../../demo/src/platform-core.js';

const source=readFileSync(new URL('../../demo/src/platform.js',import.meta.url),'utf8');

// Exercise the existing toolbar and paging entry points with a minimal DOM and
// controlled timers/API promises. Browser coverage verifies actual DOM behavior.
function toolbar(initial={query:'',status:'',priority:''}) {
  const nodes=[],timers=new Map(),requests=[];
  let active=null,timerId=0;
  const el=(tag,attrs={},...children)=>{
    const node={tag,...attrs,hidden:false,children:children.flat(Infinity),
      focus(){active=this;},setAttribute(key,value){this[key]=value;},
      replaceChildren(...next){this.children=next;}};
    nodes.push(node);return node;
  };
  const context={STATUS,PRIORITY,URLSearchParams,Map,initial,el,
    button:(text,onclick,style,symbol,attrs={})=>el('button',{onclick,class:style,...attrs},text),
    select:(id,entries,value,attrs)=>el('select',{id,value,...attrs}),
    heading:()=>null,icon:()=>null,empty:()=>null,ticketLine:ticket=>ticket,paneHeading:()=>null,
    $:selector=>nodes.find(node=>'#'+node.id===selector),
    renderMain:()=>assert.fail('Filter changes must not replace the toolbar'),
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    api:url=>new Promise((resolve,reject)=>requests.push({params:new URL(url,'https://relay.example.test').searchParams,resolve,reject})),
  };
  runInNewContext(`let filters={...initial};let ticketPage={tickets:[],total:null,nextCursor:null,loading:false,error:null},ticketListGeneration=0,ticketListTimer;
    ${source.slice(source.indexOf('function ticketsView(){'),source.indexOf('function renderMain(){'))}
    ticketsView();globalThis.pageState=()=>ticketPage;globalThis.append=()=>loadTicketPage(true);`,context);
  const control=id=>nodes.find(node=>node.id===id);
  const search=control('ticket-search'),status=control('status-filter'),priority=control('priority-filter');
  const clear=nodes.find(node=>node.tag==='button'&&node.children.includes('Clear'));
  return {search,status,priority,clear,requests,timers,context,
    get active(){return active;},
    change(node,value){node.value=value;node[node===search?'oninput':'onchange']({target:node});},
    // Start the timer without waiting for its intentionally held API response.
    start(){const pending=[...timers.values()];timers.clear();return Promise.all(pending.map(timer=>timer.callback()));},
  };
}

test('Clear visibility follows every nonempty control, including whitespace, without replacing or refocusing search',()=>{
  const view=toolbar();
  assert.equal(view.clear.hidden,true);
  for(const [node,value] of [[view.search,'   '],[view.status,'new'],[view.priority,'high']]) {
    view.search.focus();view.search.selectionStart=1;
    view.change(node,value);
    assert.equal(view.clear.hidden,false);
    assert.equal(view.active,view.search);
    assert.equal(view.search.selectionStart,1);
    view.change(node,'');
    assert.equal(view.clear.hidden,true);
  }
  for(const initial of [{query:' '},{status:'new'},{priority:'high'}]) {
    assert.equal(toolbar({query:'',status:'',priority:'',...initial}).clear.hidden,false);
  }
  view.change(view.status,'new');view.change(view.priority,'high');
  view.change(view.status,'');assert.equal(view.clear.hidden,false);
  view.change(view.priority,'');assert.equal(view.clear.hidden,true);
});

test('Clear cancels debounce, resets the cursor and controls, focuses search, and preserves first-page totals and paging',async()=>{
  const view=toolbar({query:'missing',status:'new',priority:'high'});
  view.context.pageState().nextCursor='51';
  view.change(view.search,'still missing');
  assert.equal([...view.timers.values()][0].delay,250);
  view.clear.onclick();
  assert.equal(view.search.value,'');assert.equal(view.status.value,'');assert.equal(view.priority.value,'');
  assert.equal(view.clear.hidden,true);assert.equal(view.active,view.search);
  assert.equal(view.context.pageState().nextCursor,null);
  assert.equal(view.timers.size,1);assert.equal([...view.timers.values()][0].delay,0);
  const loading=view.start();
  assert.equal(view.requests.length,1);
  assert.equal(view.requests[0].params.toString(),'query=&status=&priority=&limit=50');
  const tickets=Array.from({length:50},(_,index)=>({id:'RLY-'+(75-index)}));
  view.requests[0].resolve({tickets,total:75,nextCursor:'26'});await loading;
  assert.equal(view.context.pageState().tickets.length,50);
  assert.equal(view.context.pageState().total,75);assert.equal(view.active,view.search);
  const paging=view.context.append();
  assert.equal(view.requests[1].params.get('cursor'),'26');
  view.requests[1].resolve({tickets:[{id:'RLY-25'}],total:75,nextCursor:null});await paging;
  assert.equal(view.context.pageState().tickets.length,51);
});

for(const nextSearch of [false,true]) test('a held filtered response cannot overwrite '+(nextSearch?'the next search':'reset results'),async()=>{
  const view=toolbar();
  view.change(view.search,'old');const old=view.start();
  view.clear.onclick();const reset=view.start();
  view.requests[1].resolve({tickets:[{id:'RLY-75'}],total:75,nextCursor:'26'});await reset;
  if(nextSearch) {
    view.change(view.search,'next');const next=view.start();
    view.requests[2].resolve({tickets:[{id:'RLY-2'}],total:1,nextCursor:null});await next;
  }
  view.requests[0].resolve({tickets:[{id:'RLY-99'}],total:1,nextCursor:null});await old;
  assert.equal(view.context.pageState().tickets[0].id,nextSearch?'RLY-2':'RLY-75');
  assert.equal(view.context.pageState().total,nextSearch?1:75);
  assert.equal(view.search.value,nextSearch?'next':'');assert.equal(view.active,view.search);
});
