import { STATUS, PRIORITY, copyTicketLink, safeURL, sourceURL, mentionAt, mentionParts, insertMention, requestNeedsImplementation, commentEvidence, mergeReadiness, createAPI } from './platform-core.js';

const $ = selector => document.querySelector(selector);
const inboxPage = document.body.dataset.page === 'inbox';
const paths = {
  overview:['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  tickets:['M5 4h14v16H5z','M9 8h6M9 12h6M9 16h3'], inbox:['M3 4h18v16H3z','m3 5 9 7 9-7'],
  spark:['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z'], arrow:['M5 12h14','m14 7 5 5-5 5'],
  external:['M14 3h7v7','M21 3 10 14','M10 3H3v18h18v-7'], plus:['M12 5v14M5 12h14'], close:['m6 6 12 12M6 18 18 6'],
  check:['m5 12 4 4L19 6'], clock:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v5l3 2'],
  pr:['M6 7v10M18 17V8a3 3 0 0 0-3-3h-2','m15 2-3 3 3 3','M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4'],
  file:['M5 3h9l5 5v13H5z','M14 3v6h5M9 13h6M9 17h5'], people:['M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M1 21v-4c0-5 14-5 14 0v4M17 4c6 0 6 7 0 7M18 14c4 0 5 2 5 7'],
  search:['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14','m15 15 6 6'], bars:['M5 19v-4M12 19V9M19 19V4'],
  chevron:['m9 5 7 7-7 7'], back:['M19 12H5','m10 7-5 5 5 5'], shield:['m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z','m7 12 3 3 7-7'],
  play:['m8 4 12 8-12 8z'], refresh:['M20 8a8 8 0 1 0 0 8','M20 3v5h-5'], box:['m3 6 9-4 9 4v12l-9 4-9-4z','m3 6 9 5 9-5M12 11v11'],
};
function icon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  for(const d of paths[name] || paths.tickets){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
function el(tag,attrs={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(value===undefined||value===null||value===false)continue;
    if(key==='class')node.className=value;
    else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
    else if(key==='value')node.value=value;
    else if(value===true)node.setAttribute(key,'');
    else node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
const button=(label,action,style='button',symbol,attrs={})=>el('button',{type:'button',class:style,onclick:action,...attrs},symbol&&icon(symbol),label);
const link=(label,href,style='text-link',symbol='external')=>safeURL(href)?el('a',{href:safeURL(href),class:style,target:'_blank',rel:'noopener noreferrer'},label,symbol&&icon(symbol)):el('span',{class:'muted'},label);
const tag=text=>el('span',{class:'tag'},text);
const label=value=>STATUS[value]||PRIORITY[value]||({queued:'Queued',running:'Running',succeeded:'Complete',failed:'Failed',triage:'Triage',implement:'Implementation',evidence:'Evidence',success:'Passed',failure:'Failed',pending:'Pending',approved:'Approved',changes_requested:'Changes requested',completed:'Complete',in_progress:'Running',open:'Open',closed:'Closed'})[value]||String(value||'Pending').replaceAll('_',' ');
const badge=(value,text)=>el('span',{class:'badge '+String(value||'pending').replace(/[^a-z_]/g,'')},el('span',{class:'badge-dot'}),text||label(value));
const date=value=>{const time=new Date(value);return Number.isFinite(time.valueOf())?time.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Unknown date';};
const relative=value=>{const n=Math.max(0,Date.now()-new Date(value).valueOf());return !Number.isFinite(n)?'Unknown date':n<60000?'Just now':n<3600000?Math.floor(n/60000)+'m ago':n<86400000?Math.floor(n/3600000)+'h ago':date(value);};
let session={authenticated:false,user:null};
let workspace=null,detail=null,messages=[];
let route=inboxPage?'inbox':location.hash.slice(1)||'overview';
let filters={query:'',status:'',priority:''};
let ticketPage={tickets:[],total:null,nextCursor:null,loading:false,error:null},ticketListGeneration=0,ticketListTimer;
let activeTicket=null,activeMessage=null,busy=false,loadingDetail=false,requestGeneration=0,polling=false;
let toastTimer,detailSignature='',workspaceSignature='',inboxKey=crypto.randomUUID(),pendingInboxPayload=null;
const api=createAPI({csrf:()=>session.csrfToken});
const people=()=>workspace?.people||[];
const person=id=>people().find(p=>p.id===id);
function avatar(id,small=false) {
  const p=person(id),agent=p?.handle==='ai'||id==='ai';
  return el('span',{class:'avatar '+(['mint','violet','pink','blue','orange','green'].includes(p?.color)?p.color:'violet')+(small?' small':'')+(agent?' agent':''),title:p?.name||'Contributor'},agent?icon('spark'):p?.initials||p?.name?.slice(0,2).toUpperCase()||'?');
}
function toast(message,error=false){const node=$('#toast');(document.querySelector('dialog[open]')||document.body).append(node);node.textContent=message;node.className='toast'+(error?' error':'');node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{node.hidden=true;},6500);}
function banner(message){$('#connection-banner').textContent=message;$('#connection-banner').hidden=!message;}
function setMenu(open){$('#sidebar').classList.toggle('open',open);$('#nav-overlay').hidden=!open;$('#menu-button').setAttribute('aria-expanded',String(open));}
function navigate(next){setMenu(false);if(inboxPage){location.href='./#'+next;return;}if(location.hash!=='#'+next)location.hash=next;else loadRoute();}
function empty(title,message,symbol='tickets'){return el('div',{class:'empty-state'},el('span',{class:'empty-icon'},icon(symbol)),el('h2',{},title),el('p',{},message));}
function heading(title,description,actions){return el('header',{class:'page-heading'},el('div',{},el('p',{class:'eyebrow'},inboxPage?'SUPPORT OPERATIONS':'RELAY WORKSPACE'),el('h1',{},title),el('p',{class:'page-description'},description)),el('div',{class:'heading-actions'},actions));}
function paneHeading(title,aside){return el('div',{class:'pane-heading'},el('h2',{},title),aside);}
function field(name,id,node,hint){return el('div',{class:'field'},el('label',{for:id},name),node,hint&&el('small',{},hint));}
function select(id,entries,value,attrs={}){const node=el('select',{id,...attrs},entries.map(([key,text])=>el('option',{value:key},text)));node.value=value??'';return node;}
function showModal(title,...nodes){const dialog=$('#modal');dialog.setAttribute('aria-label',title);dialog.replaceChildren(el('div',{class:'modal-heading'},el('h2',{},title),button('',()=>dialog.close(),'icon-button','close',{'aria-label':'Close '+title})),...nodes);if(!dialog.open)dialog.showModal();return dialog;}
function requireAuth(action){if(!session.authenticated){openSignIn();return;}return action();}
function totals(){const counts=workspace?.ticketCounts;if(!counts)return {open:'—',review:'—',shipped:'—'};const shipped=(counts.statuses.merged||0)+(counts.statuses.deployed||0);return {open:counts.total-shipped,review:counts.statuses.in_review||0,shipped};}
function renderShell(){
  const integrationReady=!workspace||workspace.integration?.github&&workspace.integration?.agents;
  const integrationBanner=$('#integration-banner');integrationBanner.hidden=!!integrationReady;integrationBanner.textContent=integrationReady?'':'GitHub automation is not configured. You can explore the workspace; agent actions need a maintainer to finish the connection.';
  const openCount=totals().open;
  const nav=(name,target,symbol,count)=>el('a',{href:inboxPage?'./#'+target:'#'+target,class:'nav-item'+(!inboxPage&&(route===target||target==='tickets'&&route.startsWith('ticket/'))?' active':''),'aria-current':!inboxPage&&route===target?'page':null,onclick:event=>{event.preventDefault();navigate(target);}},icon(symbol),name,count!==undefined&&el('span',{class:'nav-count'},count));
  $('#sidebar').replaceChildren(el('a',{href:'./',class:'brand'},'Relay'),
    el('nav',{'aria-label':'Main navigation',class:'nav-group'},nav('Overview','overview','overview'),nav('Tickets','tickets','tickets',openCount),
      el('a',{href:'./inbox.html',class:'nav-item'+(inboxPage?' active':''),'aria-current':inboxPage?'page':null},icon('inbox'),'Support inbox')),
    el('div',{class:'sidebar-bottom'},
      el('a',{href:'./pipeline.html',class:'nav-item'},icon('spark'),'Pipeline dashboard',icon('external')),el('a',{href:'./showcase.html',class:'nav-item'},icon('box'),'Local playground',icon('external')),
      el('div',{class:'side-user'},icon('people'),el('div',{},el('strong',{},session.authenticated?session.user?.name||'Maintainer':'Public access'),el('small',{},session.authenticated?'Maintainer':'Read only')))));
  $('#view-title').textContent=inboxPage?'Support inbox':route.startsWith('ticket/')?activeTicket||'Ticket':route==='tickets'?'Tickets':'Overview';
  $('#session-actions').replaceChildren(session.authenticated?button('Sign out',signOut,'button small'):button('Sign in',openSignIn,'button small','shield'));
}
async function signOut(){try{await api('/api/session',{method:'DELETE'});session={authenticated:false,user:null};renderShell();renderMain();toast('Signed out. Public viewing is still available.');}catch(error){toast(error.message,true);}}
function openSignIn(){
  const errorNode=el('p',{class:'form-error',role:'alert'}),password=el('input',{id:'login-password',name:'password',type:'password',required:true,maxlength:256,autocomplete:'current-password',autofocus:true});
  const submit=el('button',{type:'submit',class:'button primary'},'Sign in');
  const form=el('form',{onsubmit:async event=>{event.preventDefault();submit.disabled=true;errorNode.textContent='';try{session=await api('/api/session',{method:'POST',body:{password:password.value}});password.value='';$('#modal').close();renderShell();renderMain();toast('Signed in. You can now contribute and run agents.');}catch(error){errorNode.textContent=error.message;}finally{submit.disabled=false;}}},
    field('Password','login-password',password),errorNode,el('div',{class:'dialog-actions'},button('Cancel',()=>$('#modal').close()),submit));
  showModal('Maintainer sign-in',el('p',{class:'modal-description'},'Maintainers can create tickets, run GitHub agents, and approve changes. Your session stays in a secure cookie.'),form);
}
function ticketLine(t){return el('article',{class:'ticket-line'},el('span',{class:'ticket-type '+t.type},icon(t.type==='feature'?'spark':'tickets')),el('div',{class:'ticket-line-main'},el('div',{class:'ticket-line-meta'},el('span',{class:'ticket-id'},t.id),...(t.tags||[]).slice(0,2).map(tag)),button(t.title,()=>navigate('ticket/'+t.id),'ticket-title-link')),el('div',{class:'ticket-line-status'},badge(t.status)),el('span',{class:'priority '+t.priority,title:label(t.priority)+' priority'},icon('bars'),label(t.priority)),el('div',{class:'ticket-avatars'},(t.contributorIds||[]).slice(0,3).map(id=>avatar(id,true))),el('time',{class:'ticket-time',datetime:t.updatedAt},relative(t.updatedAt)));}
function stats(){const counts=totals();const entries=[['Open tickets',counts.open,'tickets','From customer to clear next step'],['Agents working',workspace.activeJobCount??'—','spark','GitHub Actions, running live'],['Ready for review',counts.review,'pr','Your judgment makes the difference'],['Shipped',counts.shipped,'box','Small changes. Real progress.']];return el('section',{class:'stats-grid','aria-label':'Workspace statistics'},entries.map(([name,value,symbol,note])=>el('article',{class:'stat-card'},el('div',{class:'stat-label'},name,icon(symbol)),el('strong',{class:'stat-number'},value),el('small',{},note))));}
function overview(){
  const attention=workspace.attentionTickets||[],jobs=(workspace.jobs||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,4);
  return [heading('Good work starts with a conversation.','Turn customer requests into thoughtful, reviewed improvements.',button('New ticket',()=>requireAuth(()=>openTicketForm()),'button primary','plus')),stats(),
    el('div',{class:'overview-grid'},el('section',{class:'panel'},paneHeading('Your next move',button('All tickets',()=>navigate('tickets'),'text-button','arrow')),attention.length?attention.map(ticketLine):empty('A little breathing room','Incoming requests and tickets ready for your decision will appear here.')),
      el('section',{class:'panel workflow-summary'},paneHeading('From support to shipped',el('span',{class:'small-caps'},'THE WORKFLOW')),el('p',{class:'muted'},'Bring a request. Let agents connect the dots. Keep a human in control.'),
        [['01','Triage','An agent clarifies the request and finds the right code.'],['02','Implement','A reviewed plan becomes a linked pull request.'],['03','Demonstrate','Checks and recorded evidence make the change tangible.'],['04','Ship','You approve. GitHub merges. Cloudflare deploys.']].map(([n,title,text])=>el('div',{class:'workflow-explainer'},el('span',{},n),el('div',{},el('strong',{},title),el('p',{},text)))))),
    el('div',{class:'overview-grid bottom'},el('section',{class:'panel'},paneHeading('Agent activity',el('span',{class:'muted small'},'Recent workflow records')),jobs.length?jobs.map(jobLine):empty('Ready when you are','Mention @ai on a ticket to start a triaging run.','spark')),
      el('section',{class:'inbox-callout'},el('span',{class:'callout-icon'},icon('inbox')),el('p',{class:'eyebrow'},'A REQUEST JUST CAME IN'),el('h2',{},'Every improvement has an origin.'),el('p',{},'Try the support inbox. A fictional customer email becomes a real ticket, ready for your triage agent.'),el('a',{href:'./inbox.html',class:'button'},'Open support inbox',icon('arrow')))),
    workspace.deployment?.sha&&el('p',{class:'deployment-note'},icon('check'),'Deployed revision ',el('code',{},workspace.deployment.sha.slice(0,7)),workspace.deployment.url&&link('Open deployment',workspace.deployment.url))];
}
function ticketsView(){
  const search=el('input',{id:'ticket-search',type:'search',value:filters.query,placeholder:'Search titles, tags, or ticket IDs…','aria-label':'Search tickets',oninput:event=>{filters.query=event.target.value;reloadTicketList(250);}});
  return [heading('Tickets','Search every ticket. Refresh this list to see the latest changes.',[button('Refresh tickets',()=>reloadTicketList(),'button','refresh'),button('New ticket',()=>requireAuth(()=>openTicketForm()),'button primary','plus')]),
    el('div',{class:'filter-toolbar'},el('label',{class:'search-field',for:'ticket-search'},icon('search'),search),select('status-filter',[['','All statuses'],...Object.entries(STATUS)],filters.status,{'aria-label':'Filter by status',onchange:event=>{filters.status=event.target.value;reloadTicketList();}}),select('priority-filter',[['','All priorities'],...Object.entries(PRIORITY)],filters.priority,{'aria-label':'Filter by priority',onchange:event=>{filters.priority=event.target.value;reloadTicketList();}}),button('Clear',()=>{filters={query:'',status:'',priority:''};renderMain();reloadTicketList();},'text-button')),
    el('section',{id:'ticket-list',class:'panel ticket-list','aria-label':'Tickets','aria-busy':ticketPage.loading},listContents())];
}
function listContents(){const page=ticketPage;return [el('div',{class:'list-heading'},el('span',{},'TICKET'),el('span',{role:'status'},page.total===null?(page.error?'Tickets unavailable':'Loading tickets…'):'Showing '+page.tickets.length+' of '+page.total+' '+(page.total===1?'ticket':'tickets'))),page.tickets.map(ticketLine),page.error?el('div',{class:'error-callout',role:'alert'},el('p',{},page.error),button('Retry ticket page',()=>loadTicketPage(page.retryAppend),'button')):!page.loading&&!page.tickets.length&&empty('No matching tickets','Try another search or create a new ticket.'),page.nextCursor&&!page.error&&el('div',{class:'pane-heading'},button(page.loading?'Loading tickets…':'Load more tickets',()=>loadTicketPage(true),'button',undefined,{disabled:page.loading}))];}
function renderTicketList(){const list=$('#ticket-list');if(list){list.setAttribute('aria-busy',String(ticketPage.loading));list.replaceChildren(...listContents().flat(Infinity).filter(Boolean));}}
function reloadTicketList(delay=0){clearTimeout(ticketListTimer);ticketListGeneration++;ticketPage={tickets:[],total:null,nextCursor:null,loading:true,error:null};renderTicketList();ticketListTimer=setTimeout(()=>loadTicketPage(),delay);}
async function loadTicketPage(append=false){
  const generation=++ticketListGeneration,params=new URLSearchParams({...filters,limit:'50'});
  if(append&&ticketPage.nextCursor)params.set('cursor',ticketPage.nextCursor);
  ticketPage={...ticketPage,loading:true,error:null,retryAppend:append};renderTicketList();
  try{const next=await api('/api/tickets?'+params);if(generation!==ticketListGeneration)return;const tickets=append?[...ticketPage.tickets,...next.tickets]:next.tickets;ticketPage={tickets:[...new Map(tickets.map(ticket=>[ticket.id,ticket])).values()],total:next.total,nextCursor:next.nextCursor,loading:false,error:null};}
  catch(error){if(generation!==ticketListGeneration)return;ticketPage={...ticketPage,loading:false,error:error.message};}
  renderTicketList();
}
function renderMain(){if(!workspace)return;if(inboxPage){renderInbox();return;}if(route.startsWith('ticket/')){if(detail)renderTicket();return;}$('#main-content').className='';$('#main-content').replaceChildren(...(route==='tickets'?ticketsView():overview()).filter(Boolean));document.title=(route==='tickets'?'Tickets':'Overview')+' · Relay';}
function jobLine(job){return el('article',{class:'job-line'},el('span',{class:'job-icon '+job.status},icon(job.kind==='triage'?'spark':job.kind==='evidence'?'play':'pr')),el('div',{class:'job-content'},el('div',{class:'job-title'},el('strong',{},label(job.kind)+' agent'),badge(job.status)),job.summary&&el('p',{},job.summary),el('div',{class:'job-meta'},el('time',{datetime:job.createdAt},relative(job.createdAt)),job.headSha&&el('code',{},job.headSha.slice(0,7)),job.runUrl&&link('View run',job.runUrl))),job.ticketId&&job.ticketId!==activeTicket&&button(job.ticketId,()=>navigate('ticket/'+job.ticketId),'text-button'));}
function detailHeader(){const t=detail.ticket,ticketId=t.id;return el('div',{},el('div',{class:'ticket-breadcrumb'},button('Tickets',()=>navigate('tickets'),'text-button','back'),el('span',{},'/'),el('code',{},t.id),badge(t.status)),el('div',{class:'ticket-heading'},el('div',{},el('div',{class:'ticket-labels'},tag(t.type||'task'),...(t.tags||[]).map(tag)),el('div',{class:'ticket-title-row'},el('h1',{},t.title),button('Copy ticket link',()=>copyTicketLink(ticketId,{announce:toast}),'button copy-ticket-link')),el('p',{class:'ticket-subline'},'Opened '+date(t.createdAt),' · Updated '+relative(t.updatedAt),t.issueUrl&&link('GitHub issue #'+t.issueNumber,t.issueUrl)))),
    t.error&&el('div',{class:'error-callout',role:'alert'},el('strong',{},'This ticket needs attention'),el('p',{},t.error),!t.issueNumber&&!t.activeJobId&&!t.mergePending&&!['merged','deployed'].includes(t.status)&&!(detail.jobs||[]).some(job=>['queued','running'].includes(job.status))&&button('Retry GitHub connection',()=>requireAuth(openIssueRecovery),'button','refresh',{disabled:busy})),detail.integrationError&&el('div',{class:'error-callout',role:'status'},el('strong',{},'Live GitHub data is unavailable'),el('p',{},detail.integrationError)),t.mergePending&&el('div',{class:'notice'},'The approved revision is being merged. Comments can be saved; other changes will be available after the result is confirmed.'));
}
function descriptionSection(){const t=detail.ticket;return el('section',{class:'detail-card description-card'},paneHeading('Description',button('Edit ticket',()=>requireAuth(()=>openTicketForm(t)),'text-button','file')),el('div',{class:'prose'},t.description||'No description has been added yet.'),
  t.originalDescription&&t.originalDescription!==t.description&&el('details',{class:'original-request'},el('summary',{},'View original request'),el('p',{class:'prose'},t.originalDescription)));
}
function triageSection(){const triage=detail.ticket.triage;if(!triage)return el('section',{class:'triage-empty'},el('span',{class:'agent-mark'},icon('spark')),el('div',{},el('h3',{},'A clear brief is the first step.'),el('p',{},'Mention @ai in the discussion to clarify the request, find relevant files, and outline acceptance criteria.')));
  const triageJob=(detail.jobs||[]).filter(job=>job.kind==='triage'&&job.status==='succeeded').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  // Triage reads its captured PR head, or its base revision when no PR exists.
  // Later implementation commits must not silently change the brief's references.
  const referenceRevision=[triageJob?.headSha,triageJob?.baseSha].find(sha=>/^[a-f0-9]{40}$/i.test(sha||''));
  const references=(title,items,symbol)=>items?.length&&el('div',{class:'references'},el('h3',{},title),items.map(item=>el('div',{class:'reference'},icon(symbol),el('div',{},link(item.path,referenceRevision?sourceURL(workspace.repository,item.path,referenceRevision):null,'code-link'),el('p',{},item.reason)))));
  return el('section',{class:'detail-card triage-card'},paneHeading('The implementation brief',el('span',{class:'agent-label'},icon('spark'),'AI triage')),triage.summary&&el('p',{class:'prose'},triage.summary),triage.acceptanceCriteria?.length&&el('div',{class:'acceptance'},el('h3',{},'Acceptance criteria'),el('ul',{},triage.acceptanceCriteria.map(text=>el('li',{},icon('check'),text)))),references('Relevant code',triage.files,'file'),references('Documentation',triage.documentation,'file'),triage.ready&&el('p',{class:'ready-line'},icon('check'),'Scoped and ready for implementation'));
}
function propertiesSection(){const t=detail.ticket;const assigned=person(t.assigneeId);return el('section',{class:'detail-card properties-card'},paneHeading('Properties',button('Edit',()=>requireAuth(()=>openTicketForm(t)),'text-button',undefined,{'aria-label':'Edit ticket properties'})),
  el('dl',{class:'property-list'},el('div',{},el('dt',{},'Status'),el('dd',{},badge(t.status))),el('div',{},el('dt',{},'Priority'),el('dd',{class:'priority '+t.priority},icon('bars'),label(t.priority))),el('div',{},el('dt',{},'Type'),el('dd',{},(t.type||'task').replace(/^./,v=>v.toUpperCase()))),el('div',{},el('dt',{},'Assignee'),el('dd',{},assigned?el('span',{class:'person-inline'},avatar(assigned.id,true),assigned.name):'Unassigned')),el('div',{},el('dt',{},'Repository'),el('dd',{},link(workspace.repository,'https://github.com/'+workspace.repository,'repo-link')))),
  el('div',{class:'property-section'},el('h3',{},'Contributors',el('span',{class:'count-pill'},(t.contributorIds||[]).length)),el('div',{class:'contributor-list'},(t.contributorIds||[]).map(id=>{const p=person(id);return el('div',{class:'contributor'},avatar(id,true),el('div',{},el('strong',{},p?.name||id),el('small',{},'@'+(p?.handle||id))));})),!(t.contributorIds||[]).length&&el('p',{class:'muted small'},'Mention someone to bring them into the conversation.'),el('p',{class:'property-hint'},'@mentions automatically add contributors.')),
  el('div',{class:'property-section'},el('h3',{},'Tags'),el('div',{class:'tags'},(t.tags||[]).length?t.tags.map(tag):el('span',{class:'muted small'},'No tags yet'))));
}
function pendingDispatch(value){return value?.ticket&&!value.ticket.mergePending&&!['human_edit','merged','deployed'].includes(value.ticket.status)&&(value.jobs||[]).find(job=>job.id===value.ticket.activeJobId&&job.status==='queued'&&job.dispatchState==='pending'&&!job.runId);}
function resumableDispatch(value){const job=pendingDispatch(value);return job&&(job.dispatchUntil||0)<=Date.now()?job:null;}
function detailStamp(value){return JSON.stringify([value,resumableDispatch(value)?.id||null]);}
function workflowSection(){
  const t=detail.ticket,jobs=detail.jobs||[],active=jobs.some(j=>['queued','running'].includes(j.status)),readonly=!session.authenticated;
  const dispatch=pendingDispatch(detail),resume=resumableDispatch(detail);
  const action=(name,value,style='button',symbol='spark',disabled=false)=>button(name,()=>requireAuth(()=>ticketAction(value)),style,symbol,{disabled:busy||disabled||t.mergePending||(active&&value!=='human-edit')});
  const actions=[];
  if(t.status==='human_edit')actions.push(action('Resume agents','resume','button primary','play'));
  else if(!['merged','deployed'].includes(t.status)){
    if(resume)actions.push(button('Resume queued agent',()=>requireAuth(()=>ticketAction(resume.kind)),'button primary','refresh',{disabled:busy||t.mergePending}));
    if(t.pendingAgent){if(!active)actions.push(action('Retry saved request',t.prNumber?'implement':'triage','button primary','spark'));}
    else{
      if(!t.prNumber)actions.push(action(t.triage?'Run triage again':'Start triage','triage','button','spark'));
      if(!t.prNumber&&t.triage?.ready)actions.push(action('Start implementation','implement','button primary','pr'));
      if(t.prNumber&&!requestNeedsImplementation(t))actions.push(action('Generate evidence','evidence','button','play'));
    }
    actions.push(action('Switch to human editing','human-edit','text-button','people'));
  }
  return el('section',{class:'detail-card workflow-card'},paneHeading('Agent workflow',el('span',{class:'tiny-live'},el('span'), 'GitHub Actions')),
    active&&el('p',{class:'agent-running'},el('span',{class:'loading-orbit small'}),dispatch?'An agent is queued. This ticket updates automatically.':'An agent is working. This ticket updates automatically.'),
    dispatch&&el('p',{class:'notice'},resume?'Resume this queued agent to continue the existing job.':'Waiting for GitHub dispatch confirmation. Recovery will be available when this attempt times out.'),
    requestNeedsImplementation(t)&&!['merged','deployed'].includes(t.status)&&el('p',{class:'notice'},'The request changed after this PR was implemented. '+(t.status==='human_edit'?'Resume agents, then mention @ai or post feedback to implement the updated request.':'Mention @ai or post feedback to implement the updated request before generating evidence.')),
    t.pendingAgent&&el('p',{class:'notice'},active?'Your request is saved. One follow-up agent will start after the current run finishes.':'Your request is saved. Retry it to start the next agent run.'),
    t.status==='human_edit'&&el('p',{class:'notice'},'Human editing is active. Comments stay in the conversation; resume agents when you are ready.'),
    el('div',{class:'workflow-actions'},actions),readonly&&actions.length>0&&el('p',{class:'small muted'},'Maintainer sign-in is required to run agents.'),
    jobs.length>=40&&el('p',{class:'small muted'},'Showing the latest 40 agent runs.'),jobs.length?el('div',{class:'job-timeline'},jobs.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(jobLine)):el('p',{class:'small muted'},'No agent runs yet. Each run and its result will appear here.'));
}
function prSection(){const pr=detail.pullRequest;if(!pr)return detail.ticket.prUrl?el('section',{class:'detail-card'},paneHeading('Pull request'),link('Open pull request #'+detail.ticket.prNumber,detail.ticket.prUrl),el('p',{class:'muted small'},'Live checks are not available yet.')):null;const readiness=mergeReadiness(detail);
  return el('section',{class:'detail-card pr-card'},paneHeading('Pull request',badge(pr.state)),link('#'+pr.number+' '+pr.title,pr.url,'pr-title'),el('div',{class:'revision-label'},icon('pr'),'Current revision',el('code',{},(pr.headSha||'').slice(0,7))),
    pr.freshness&&el('p',{class:'small muted'},'GitHub checked ',el('time',{datetime:pr.freshness.fetchedAt,title:new Date(pr.freshness.fetchedAt).toLocaleString()},relative(pr.freshness.fetchedAt)),'. '+(pr.freshness.cached?'Cached for up to 30 seconds. ':'Reads may be cached for 30 seconds. ')+'Merge eligibility is rechecked live.'),
    el('div',{class:'check-list'},(pr.checks||[]).map(check=>el('div',{class:'check-row'},el('span',{},check.name),badge(check.status==='completed'?check.conclusion:check.status))),!(pr.checks||[]).length&&el('p',{class:'muted small'},'No checks reported for this revision.'),el('div',{class:'check-row'},el('span',{},'Independent review'),badge(String(pr.reviewState||'pending').toLowerCase()))),
    pr.files?.length&&el('details',{class:'changed-files'},el('summary',{},pr.files.length+' changed files'),pr.files.map(file=>el('div',{class:'file-change'},link(file.path,sourceURL(workspace.repository,file.path,pr.headSha),'code-link'),el('span',{class:'added'},'+'+file.additions),el('span',{class:'removed'},'−'+file.deletions)))),
    pr.state==='open'&&el('div',{class:'merge-gate'},button('Approve and merge',()=>requireAuth(openMerge),'button primary','pr',{disabled:busy||!readiness.ready}),el('p',{},readiness.reason)));
}
function evidenceItem(item){
  const href=safeURL(item.url),current=detail.pullRequest?.headSha||detail.ticket.headSha,same=!current||item.headSha===current;
  const video=href&&item.kind==='video'&&/\.(mp4|webm)(?:\?|$)/i.test(href);
  return el('article',{class:'evidence-item'},el('div',{class:'evidence-title'},icon(item.kind==='video'?'play':'file'),link(item.title,item.url,'evidence-link')),el('p',{class:'evidence-meta'},item.kind+' · '+(item.headSha||'').slice(0,7),!same&&el('span',{class:'older-revision'},'Earlier revision')),video&&el('video',{controls:true,preload:'none',src:href,'aria-label':item.title}),!href&&el('p',{class:'form-error'},'Evidence link unavailable.'));
}
function evidenceHelp(){return el('p',{class:'evidence-help'},'Download the ZIP and open the HTML report or a .webm recording. GitHub may ask you to sign in.');}
function evidenceSection(){const evidence=detail.evidence||[];
  return el('section',{class:'detail-card'},paneHeading('Evidence',el('span',{class:'count-pill'},evidence.length)),!evidence.length?el('p',{class:'muted small'},'The evidence agent can write and run end-to-end tests for the current PR. Reports, recordings, and artifacts will appear here.'):evidence.map(evidenceItem),evidence.length>0&&evidenceHelp());
}
function commentResults(comment){
  const job=commentEvidence(comment,detail.jobs);if(!job)return null;
  const current=detail.pullRequest?.headSha||detail.ticket.headSha,earlier=current&&job.headSha!==current;
  const changed=(job.requestRevision||0)!==(detail.ticket.requestRevision||0);
  const evidence=job.status==='succeeded'?(job.evidence||[]):[];
  return el('section',{class:'comment-evidence','aria-label':'E2E results'},
    el('div',{class:'comment-evidence-heading'},el('strong',{},'E2E browser results'),badge(job.status,job.status==='succeeded'?'Passed':'Failed')),
    el('div',{class:'comment-evidence-meta'},job.headSha&&el('code',{},job.headSha.slice(0,7)),earlier&&el('span',{class:'older-revision'},'Earlier revision'),changed&&el('span',{class:'older-revision'},'Request changed'),job.runUrl&&link('View test run',job.runUrl)),
    evidence.map(evidenceItem),evidence.length?evidenceHelp():el('p',{class:'evidence-help'},'Open the test run for logs and any available failure screenshots or traces.'));
}
function renderComments(){const host=$('#comment-list');if(!host)return;const comments=(detail.comments||[]).slice().sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));host.replaceChildren(...(comments.length?comments.map(comment=>{const p=person(comment.authorId);return el('article',{class:'comment'},avatar(comment.authorId),el('div',{class:'comment-content'},el('header',{},el('strong',{},p?.name||'Contributor'),p?.handle==='ai'&&el('span',{class:'agent-label'},'AGENT'),comment.kind==='feedback'&&tag('Feedback'),el('time',{datetime:comment.createdAt,title:new Date(comment.createdAt).toLocaleString()},relative(comment.createdAt))),el('div',{class:'comment-body'},...mentionText(comment.body)),commentResults(comment)));}):[el('p',{class:'discussion-empty'},'Start the conversation. Share context, mention a teammate, or bring in @ai.')]));const count=$('#comment-count');if(count)count.textContent=comments.length>=300?'Latest 300':comments.length;}
function mentionText(text){return mentionParts(text,people().map(p=>p.handle)).map(part=>part.handle?el('span',{class:'mention'},part.text):part.text);}
function composer(){
  if(!session.authenticated)return el('div',{id:'comment-composer',class:'signin-prompt'},icon('people'),el('div',{},el('strong',{},'Add your perspective.'),el('p',{},'Sign in to comment, mention contributors, and work with agents.')),button('Sign in to comment',openSignIn,'button'));
  const textarea=el('textarea',{id:'comment-body',name:'body',required:true,maxlength:8000,placeholder:'Add context or feedback… Mention @ai to bring in an agent.','aria-label':'Write a comment'});
  const suggestions=el('div',{id:'mention-suggestions',class:'mention-suggestions',role:'listbox','aria-label':'Mention a contributor',hidden:true});
  let mention=null,selected=0,matches=[];
  function hide(){suggestions.hidden=true;textarea.setAttribute('aria-expanded','false');textarea.removeAttribute('aria-activedescendant');}
  function choose(p){if(!mention)return;const next=insertMention(textarea.value,mention,p.handle);textarea.value=next.text;textarea.focus();textarea.setSelectionRange(next.caret,next.caret);hide();}
  function update(){mention=mentionAt(textarea.value,textarea.selectionStart);matches=mention?people().filter(p=>p.handle?.toLowerCase().startsWith(mention.query)||p.name?.toLowerCase().includes(mention.query)).slice(0,6):[];selected=0;draw();}
  function draw(){if(!matches.length||!mention){hide();return;}suggestions.hidden=false;textarea.setAttribute('aria-expanded','true');textarea.setAttribute('aria-activedescendant','mention-'+selected);suggestions.replaceChildren(...matches.map((p,index)=>el('button',{type:'button',id:'mention-'+index,role:'option','aria-selected':index===selected,class:'mention-option'+(index===selected?' selected':''),onmousedown:event=>event.preventDefault(),onclick:()=>choose(p)},avatar(p.id,true),el('span',{},el('strong',{},p.name),el('small',{},'@'+p.handle)),p.handle==='ai'&&el('span',{class:'mention-action'},'Start an agent'))));}
  textarea.setAttribute('aria-controls','mention-suggestions');textarea.setAttribute('aria-autocomplete','list');textarea.setAttribute('aria-expanded','false');
  textarea.addEventListener('input',update);textarea.addEventListener('click',update);textarea.addEventListener('keydown',event=>{if(suggestions.hidden)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;draw();}else if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();choose(matches[selected]);}else if(event.key==='Escape'){event.preventDefault();hide();}});
  const kind=select('comment-kind',[['comment','Comment'],['feedback','Feedback']], 'comment',{'aria-label':'Comment type'}),errorNode=el('p',{class:'form-error',role:'alert'}),submit=el('button',{type:'submit',class:'button primary'},'Post comment',icon('arrow'));
  const form=el('form',{id:'comment-composer',class:'comment-composer',onsubmit:async event=>{event.preventDefault();const body=textarea.value.trim();if(!body)return;submit.disabled=true;errorNode.textContent='';try{await mutation('/api/tickets/'+encodeURIComponent(activeTicket)+'/comments',{body,kind:kind.value});textarea.value='';hide();toast('Comment posted.');}catch(error){errorNode.textContent=error.message;}finally{submit.disabled=false;}}},
    el('div',{class:'compose-editor'},textarea,suggestions),el('div',{class:'compose-toolbar'},el('div',{},button('@',()=>{const start=textarea.selectionStart;textarea.value=textarea.value.slice(0,start)+'@'+textarea.value.slice(start);textarea.focus();textarea.setSelectionRange(start+1,start+1);update();},'mention-trigger',undefined,{'aria-label':'Mention a contributor'}),kind),submit),errorNode,
    el('p',{class:'composer-note'},'@mentions add contributors. @ai starts triage, or revises an existing PR. Feedback reruns implementation unless human editing is active.'));
  return form;
}
function renderTicket(){
  if(!detail)return;const t=detail.ticket;document.title=t.id+' · '+t.title+' · Relay';$('#main-content').className='ticket-page';
  const composerNode=$('#comment-composer');const preserve=composerNode&&composerNode.dataset.ticket===t.id&&composerNode.dataset.auth===String(session.authenticated);
  const draftNode=preserve?composerNode:composer();draftNode.dataset.ticket=t.id;draftNode.dataset.auth=String(session.authenticated);
  // Keep the actual editor node alive when a poll or mutation updates the surrounding ticket.
  const focused=document.activeElement,selection=focused?.id==='comment-body'?[focused.selectionStart,focused.selectionEnd]:null;
  $('#main-content').replaceChildren(el('div',{id:'ticket-header'},detailHeader()),el('div',{class:'ticket-layout'},el('div',{class:'ticket-main'},descriptionSection(),triageSection(),el('section',{class:'detail-card discussion-card'},paneHeading('Discussion',el('span',{class:'count-pill',id:'comment-count'},(detail.comments||[]).length)),el('div',{id:'comment-list',class:'comment-list'}),draftNode)),el('aside',{class:'ticket-properties','aria-label':'Ticket properties'},propertiesSection(),workflowSection(),prSection(),evidenceSection())));
  renderComments();if(preserve&&focused&&draftNode.contains(focused)){focused.focus({preventScroll:true});if(selection)focused.setSelectionRange(...selection);}renderShell();
}
async function mutation(path,body,method='POST'){
  const target=activeTicket,result=await api(path,{method,body});
  if(result.ticket&&activeTicket===target){detail=result;detailSignature=detailStamp(result);renderTicket();}
  await refreshWorkspace(false).catch(error=>banner('Saved successfully, but the workspace refresh failed: '+error.message));return result;
}
async function ticketAction(action,headSha){if(busy)return;busy=true;try{await mutation('/api/tickets/'+encodeURIComponent(activeTicket)+'/actions',{action,...(headSha?{headSha}:{})});toast(action==='approve-merge'?'Merge requested. The platform will track deployment.':action==='human-edit'?'Human editing enabled.':action==='resume'?'Agent workflow resumed.':'Agent run requested. Follow its progress in the workflow timeline.');}catch(error){toast(error.message,true);}finally{busy=false;renderMain();}}
function openMerge(){const pr=detail.pullRequest,headSha=pr.headSha,ticketId=activeTicket;const errorNode=el('p',{class:'form-error',role:'alert'});const confirm=button('Merge this revision',async()=>{confirm.disabled=true;errorNode.textContent='';try{if(activeTicket!==ticketId)throw new Error('The active ticket changed. Reopen the merge confirmation.');await mutation('/api/tickets/'+encodeURIComponent(ticketId)+'/actions',{action:'approve-merge',headSha});$('#modal').close();toast('Pull request merged. Deployment progress will appear on this ticket.');}catch(error){errorNode.textContent=error.message;}finally{confirm.disabled=false;}},'button primary','pr');
  showModal('Approve and merge',el('p',{class:'modal-description'},'Approve the reviewed change and merge it into the repository. GitHub Actions will deploy main to Cloudflare.'),el('div',{class:'merge-confirmation'},el('strong',{},'#'+pr.number+' '+pr.title),el('p',{},'You are approving this exact revision:'),el('code',{},headSha)),el('p',{class:'small muted'},'The server checks the current revision, checks, review, and evidence again before merging.'),errorNode,el('div',{class:'dialog-actions'},button('Cancel',()=>$('#modal').close()),confirm));
}
function openIssueRecovery(){
  const ticketId=activeTicket,errorNode=el('p',{class:'form-error',role:'alert'}),confirm=button('Confirm issue recovery',async()=>{confirm.disabled=true;errorNode.textContent='';try{if(activeTicket!==ticketId)throw new Error('The active ticket changed. Reopen this confirmation.');await mutation('/api/tickets/'+encodeURIComponent(ticketId)+'/actions',{action:'retry-issue',confirmRetry:true});$('#modal').close();toast('GitHub issue connected. No agent was started.');}catch(error){errorNode.textContent=error.message;}finally{confirm.disabled=false;}},'button primary','refresh');
  showModal('Retry GitHub connection',el('p',{class:'modal-description'},'Relay checks for an existing issue first. If the previous result was uncertain and no matching issue is found, your confirmation authorizes creating another GitHub issue. A delayed earlier request could still have created one.'),el('p',{class:'small muted'},'This only reconnects the ticket. It does not start a paid agent or resume automation.'),errorNode,el('div',{class:'dialog-actions'},button('Cancel',()=>$('#modal').close()),confirm));
}
function openTicketForm(current){
  const isEdit=!!current,formId='ticket-form-',input=(name,value,attrs={})=>el('input',{id:formId+name,name,value:value||'',...attrs});
  const title=input('title',current?.title,{required:true,maxlength:160,autofocus:true,placeholder:'What could be better?'}),description=el('textarea',{id:formId+'description',name:'description',required:true,maxlength:12000,rows:6,placeholder:'Describe the request, current behavior, and what a good outcome looks like.'},current?.description||'');
  const priority=select(formId+'priority',Object.entries(PRIORITY),current?.priority||'medium',{name:'priority'}),assignee=select(formId+'assigneeId',[['','Unassigned'],...people().filter(p=>p.handle!=='ai').map(p=>[p.id,p.name])],current?.assigneeId||'',{name:'assigneeId'}),tagsInput=input('tags',(current?.tags||[]).join(', '),{maxlength:300,placeholder:'customer-feedback, usability'});
  const type=select(formId+'type',[['bug','Bug report'],['feature','Feature request'],['task','Task']],current?.type||'feature',{name:'type',disabled:isEdit});
  const contributors=el('fieldset',{class:'contributor-fieldset'},el('legend',{},'Contributors'),people().map(p=>el('label',{class:'contributor-option'},el('input',{type:'checkbox',name:'contributorIds',value:p.id,checked:(current?.contributorIds||[]).includes(p.id)}),avatar(p.id,true),p.name)));
  const errorNode=el('p',{class:'form-error',role:'alert'}),submit=el('button',{type:'submit',class:'button primary'},isEdit?'Save changes':'Create ticket');
  const form=el('form',{onsubmit:async event=>{event.preventDefault();submit.disabled=true;errorNode.textContent='';const payload={title:title.value.trim(),description:description.value.trim(),priority:priority.value,assigneeId:assignee.value,tags:[...new Set(tagsInput.value.split(',').map(s=>s.trim()).filter(Boolean))],contributorIds:[...new FormData(form).getAll('contributorIds')]};if(isEdit)payload.version=current.version;else payload.type=type.value;
    try{const result=await api(isEdit?'/api/tickets/'+encodeURIComponent(current.id):'/api/tickets',{method:isEdit?'PATCH':'POST',body:payload});$('#modal').close();detail=result;activeTicket=result.ticket.id;detailSignature=detailStamp(result);await refreshWorkspace(false).catch(error=>banner('Ticket saved. Workspace refresh failed: '+error.message));navigate('ticket/'+result.ticket.id);toast(isEdit?'Ticket updated.':'Ticket created. Mention @ai to start triage.');}
    catch(error){errorNode.textContent=error.message+(error.status===409?' Your draft is still here. Copy any changes you want to keep, then close and reopen the editor to work from the latest ticket.':'');if(error.status===409)await refreshTicket(false);}finally{submit.disabled=false;}}},
    el('div',{class:'form-fields'},field('Title',formId+'title',title),field('Description',formId+'description',description),el('div',{class:'form-grid'},field('Type',formId+'type',type),field('Priority',formId+'priority',priority),field('Assignee',formId+'assigneeId',assignee),field('Tags (comma separated)',formId+'tags',tagsInput)),contributors),errorNode,
    el('div',{class:'dialog-actions'},button('Cancel',()=>$('#modal').close()),submit));
  showModal(isEdit?'Edit ticket':'New ticket',el('p',{class:'modal-description'},isEdit?'Keep the brief useful and bring the right people into the work.':'Give the request a little context. Your team and agents can take it from here.'),form);
}
function inboxItem(message){return button('',()=>{activeMessage=message.id;renderInboxReading();document.querySelectorAll('.mail-item').forEach(node=>node.classList.toggle('selected',node.dataset.id===message.id));},'mail-item'+(activeMessage===message.id?' selected':''),undefined,{'data-id':message.id,'aria-label':message.subject});}
function mailListItem(message){const node=inboxItem(message);node.append(el('div',{class:'mail-item-top'},el('strong',{},message.senderName),el('time',{},date(message.createdAt))),el('strong',{class:'mail-subject'},message.subject),el('p',{},message.body.slice(0,100)),el('span',{class:'mail-ticket'},icon('tickets'),message.ticketId));return node;}
function renderInbox(){
  if(!activeMessage&&messages.length)activeMessage=messages[0].id;
  $('#main-content').className='inbox-page';$('#main-content').replaceChildren(heading('A conversation becomes a better product.','A demo support inbox, connected to your real ticket workflow.',button('Simulate incoming email',()=>requireAuth(openEmailForm),'button primary','plus')),
    el('div',{class:'inbox-demo-note'},icon('inbox'),el('span',{},el('strong',{},'Demo mailbox'),' · Compose fictional customer email. Receiving a message creates a ticket and queues real AI triage. No email is sent.')),
    el('div',{class:'inbox-layout'},el('section',{class:'panel mailbox','aria-label':'Inbox messages'},paneHeading('Inbox',el('span',{class:'count-pill'},messages.length>=100?'Latest 100':messages.length)),messages.length?messages.map(mailListItem):empty('Your inbox is ready','Simulate a support email to see the journey begin.','inbox')),el('section',{id:'mail-reading',class:'panel mail-reading','aria-label':'Email details'})));
  renderInboxReading();document.title='Support inbox · Relay';
}
function renderInboxReading(){const host=$('#mail-reading');if(!host)return;const message=messages.find(m=>m.id===activeMessage);if(!message){host.replaceChildren(empty('There is a story behind every ticket.','Select an email, or simulate a new customer request.','inbox'));return;}
  host.replaceChildren(el('div',{class:'mail-reading-header'},el('span',{class:'small-caps'},'INCOMING CUSTOMER REQUEST'),el('h2',{},message.subject),el('div',{class:'mail-sender'},el('span',{class:'avatar blue'},message.senderName.slice(0,2).toUpperCase()),el('div',{},el('strong',{},message.senderName),el('small',{},message.senderEmail)),el('time',{},date(message.createdAt)))),el('div',{class:'mail-body prose'},message.body),el('div',{class:'mail-ticket-card'},el('span',{class:'agent-mark'},icon('spark')),el('div',{},el('strong',{},'The conversation continues in Relay'),el('p',{},'Ticket '+message.ticketId+' · Agent progress and decisions are tracked on the ticket.')),el('a',{href:'./#ticket/'+encodeURIComponent(message.ticketId),class:'button'},'Open ticket',icon('arrow'))));
}
function openEmailForm(){
  const input=(name,value,attrs={})=>el('input',{id:'email-'+name,name,value,...attrs});
  const name=input('senderName','Jamie Parker',{required:true,maxlength:100}),email=input('senderEmail','jamie@example.com',{type:'email',required:true,maxlength:160}),subject=input('subject','',{required:true,maxlength:160,placeholder:'A small improvement that would make a big difference'}),body=el('textarea',{id:'email-body',name:'body',required:true,maxlength:8000,rows:7,placeholder:'Hi team,\n\nI was using Relay and noticed…'});
  const errorNode=el('p',{class:'form-error',role:'alert'}),submit=el('button',{type:'submit',class:'button primary'},'Receive email and triage');
  if(pendingInboxPayload){name.value=pendingInboxPayload.senderName;email.value=pendingInboxPayload.senderEmail;subject.value=pendingInboxPayload.subject;body.value=pendingInboxPayload.body;}
  const form=el('form',{onsubmit:async event=>{event.preventDefault();submit.disabled=true;errorNode.textContent='';const payload={senderName:name.value.trim(),senderEmail:email.value.trim(),subject:subject.value.trim(),body:body.value.trim()};
    if(pendingInboxPayload&&JSON.stringify(pendingInboxPayload)!==JSON.stringify(payload))inboxKey=crypto.randomUUID();pendingInboxPayload=payload;
    try{const result=await api('/api/inbox',{method:'POST',body:{...payload,idempotencyKey:inboxKey}});
      if(result.message?.processingComplete!==true)throw new Error(result.ticket?.error||'Email saved, but processing is incomplete. Retry delivery to resume triage.');
      pendingInboxPayload=null;inboxKey=crypto.randomUUID();$('#modal').close();activeMessage=result.message.id;messages=[result.message,...messages.filter(m=>m.id!==result.message.id)];renderInbox();await refreshInbox().catch(error=>banner('Email received. Inbox refresh failed: '+error.message));toast('Email received. Ticket '+(result.ticket.id||result.message.ticketId)+' created and triage requested.');}
    catch(error){errorNode.textContent=error.message+' Your email draft is preserved. Retrying the same request will not create a duplicate ticket.';}finally{submit.disabled=false;}}},
    el('div',{class:'form-grid'},field('Sender name','email-senderName',name),field('Sender email','email-senderEmail',email)),field('Subject','email-subject',subject),field('Email body','email-body',body),errorNode,el('div',{class:'dialog-actions'},button('Cancel',()=>$('#modal').close()),submit));
  showModal('Simulate incoming email',el('p',{class:'modal-description'},'Use fictional customer details. This creates a real support ticket and starts a GitHub Actions triage run; it does not send email.'),form);
}
async function refreshWorkspace(render=true){const next=await api('/api/workspace'),signature=JSON.stringify(next);workspace=next;if(signature!==workspaceSignature){workspaceSignature=signature;renderShell();if(render&&!activeTicket)renderMain();}return next;}
async function refreshTicket(showError=true){if(!activeTicket||loadingDetail)return;const id=activeTicket,generation=requestGeneration;try{const next=await api('/api/tickets/'+encodeURIComponent(id));if(id!==activeTicket||generation!==requestGeneration)return;const signature=detailStamp(next);if(signature!==detailSignature){detail=next;detailSignature=signature;renderTicket();}banner('');}catch(error){if(showError&&id===activeTicket)banner('Live updates paused: '+error.message+' Showing the last received ticket.');}}
async function refreshInbox(){const next=await api('/api/inbox');messages=next.messages||[];if(inboxPage)renderInbox();}
async function loadRoute(){
  route=inboxPage?'inbox':location.hash.slice(1)||'overview';requestGeneration++;ticketListGeneration++;clearTimeout(ticketListTimer);const generation=requestGeneration;
  if(!inboxPage&&!['overview','tickets'].includes(route)&&!/^ticket\/[A-Za-z0-9-]+$/.test(route)){route='overview';history.replaceState(null,'','#overview');}
  activeTicket=route.startsWith('ticket/')?route.slice(7):null;renderShell();
  if(!workspace)return;
  if(activeTicket){const id=activeTicket;if(detail?.ticket.id===id){renderTicket();refreshTicket();return;}detail=null;detailSignature='';loadingDetail=true;$('#main-content').replaceChildren(el('div',{class:'loading-state'},el('span',{class:'loading-orbit'}),el('h1',{},'Opening '+id)));
    try{const next=await api('/api/tickets/'+encodeURIComponent(id));if(generation!==requestGeneration)return;detail=next;detailSignature=detailStamp(next);renderTicket();banner('');}catch(error){if(generation===requestGeneration){$('#main-content').replaceChildren(empty('This ticket could not be opened',error.message),button('Back to tickets',()=>navigate('tickets'),'button'));banner(error.message);}}finally{if(generation===requestGeneration)loadingDetail=false;}
  }else{loadingDetail=false;renderMain();if(route==='tickets')reloadTicketList();}
}
async function poll(){if(polling||document.hidden||!workspace)return;polling=true;try{await refreshWorkspace(false);if(activeTicket)await refreshTicket();else if(inboxPage){if(!$('#modal').open)await refreshInbox();}else if(route!=='tickets'&&!document.activeElement?.closest('input,textarea,select'))renderMain();}catch(error){banner('Live updates paused: '+error.message+' Showing the last successful snapshot.');}finally{polling=false;}}
async function start(){renderShell();const results=await Promise.allSettled([api('/api/session'),api('/api/workspace'),...(inboxPage?[api('/api/inbox')]:[])]);if(results[0].status==='fulfilled')session=results[0].value;
  if(results[1].status==='rejected'){$('#main-content').replaceChildren(empty('The workspace is temporarily unavailable',results[1].reason.message),button('Try again',start,'button primary'));banner('Could not connect to the platform. No sample data has been substituted.');renderShell();return;}
  workspace=results[1].value;workspaceSignature=JSON.stringify(workspace);if(inboxPage&&results[2]?.status==='fulfilled')messages=results[2].value.messages||[];
  if(inboxPage&&results[2]?.status==='rejected')banner('The inbox could not be loaded: '+results[2].reason.message);
  else if(results[0].status==='rejected')banner('Session status could not be verified. Public data is available; sign in before making changes.');else banner('');
  renderShell();await loadRoute();
}
$('#menu-button').addEventListener('click',()=>setMenu(!$('#sidebar').classList.contains('open')));$('#nav-overlay').addEventListener('click',()=>setMenu(false));
window.addEventListener('hashchange',loadRoute);window.addEventListener('online',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMenu(false);if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,dialog'))return;if(event.key.toLowerCase()==='n'&&!inboxPage){event.preventDefault();requireAuth(()=>openTicketForm());}if(event.key==='/'){event.preventDefault();if(!$('#ticket-search'))navigate('tickets');setTimeout(()=>$('#ticket-search')?.focus(),0);}});
$('#modal').addEventListener('click',event=>{const dialog=$('#modal');if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
setInterval(poll,8000);start();
