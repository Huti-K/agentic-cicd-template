import { createSeed } from './seed.js';
import { STATUSES, PRIORITIES, createTicket, updateTicket, createPullRequest, runChecks, reviewPullRequest, applySuggestedFix, mergePullRequest, filterTickets, metrics, loadWorkspace, saveWorkspace } from './workspace.js';
import { DEFAULT_REPOSITORY, parseRepository, githubURL, issueDraftURL, createGitHubClient } from './github.js';

const $ = selector => document.querySelector(selector);
const paths = {
  relay: ['M5 20V4h9a5 5 0 0 1 0 10h-3','m12 10 8 10'], overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  tickets: ['M5 4h14v16H5z','M9 8h6M9 12h6M9 16h3'], pr: ['M6 7v10M18 17V8a3 3 0 0 0-3-3h-2','m15 2-3 3 3 3','M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4'],
  projects: ['M3 6h7l2 2h9v12H3z','M3 6V4h7l2 2h7'], activity: ['M3 12h4l3-8 4 16 3-8h4'],
  github: ['M9 19c-5 1-5-2-7-2m14 5v-4a4 4 0 0 0-1-3c4 0 6-2 6-5 0-1-1-3-2-3 0-1 0-3-1-4-2 0-3 1-4 1-2-1-4-1-6 0-1 0-2-1-4-1-1 1-1 3-1 4-1 0-2 2-2 3 0 3 2 5 6 5a4 4 0 0 0-1 3v4'],
  arrow: ['M5 12h14','m14 7 5 5-5 5'], external: ['M14 3h7v7','M21 3 10 14','M10 3H3v18h18v-7'],
  plus: ['M12 5v14M5 12h14'], close: ['m6 6 12 12M6 18 18 6'], check: ['m5 12 4 4L19 6'],
  board: ['M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z'], list: ['M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1'],
  spark: ['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z'], bars: ['M5 19v-4M12 19V9M19 19V4'],
  orbit: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M3 12h18M12 3c-6 4-6 14 0 18 6-4 6-14 0-18'],
  compass: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','m16 8-2 6-6 2 2-6z'],
  layers: ['m12 3 10 5-10 5L2 8z','m2 12 10 5 10-5M2 16l10 5 10-5'], grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v5l3 2'], refresh: ['M20 8a8 8 0 1 0 0 8','M20 3v5h-5'],
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  for (const d of paths[name] || paths.tickets) {
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',d); svg.append(path);
  }
  return svg;
}
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if (key === 'value') node.value = value;
    else if (value === true) node.setAttribute(key,'');
    else node.setAttribute(key,String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (label, action, className = 'button', symbol) => el('button',{type:'button',class:className,onclick:action},symbol && icon(symbol),label);
const external = (label, href, className = 'button', symbol = 'external') => el('a',{href,target:'_blank',rel:'noopener noreferrer',class:className},label,icon(symbol));
const labelFor = value => ({ passed:'Passed',failed:'Failed',pending:'Pending',approved:'Approved',changes_requested:'Changes requested',open:'Open',merged:'Merged',closed:'Closed',success:'Passed',failure:'Failed',in_progress:'Running',queued:'Queued',completed:'Completed',cancelled:'Cancelled',skipped:'Skipped',neutral:'Neutral',timed_out:'Timed out',action_required:'Action needed' })[value] || String(value || 'Unknown').replaceAll('_',' ');
function badge(value, customLabel) {
  const tone = ['passed','approved','success','open'].includes(value) ? 'success' : ['failed','failure','changes_requested','timed_out'].includes(value) ? 'failure' : value === 'merged' ? 'purple' : ['pending','queued','in_progress'].includes(value) ? 'warning' : '';
  return el('span',{class:'badge '+tone},customLabel || labelFor(value));
}
const project = id => state.projects.find(p=>p.id===id);
const person = id => state.people.find(p=>p.id===id);
const avatar = (id, small = false) => id === 'agent' ? el('span',{class:'avatar agent',title:'Relay agent · simulated'},icon('spark')) : el('span',{class:'avatar '+(person(id)?.color || '')+(small?' small':''),title:person(id)?.name || 'Unassigned'},person(id)?.initials || '—');
const priority = value => el('span',{class:'priority '+value},icon('bars'),PRIORITIES[value]);
const statusLabel = value => el('span',{class:'status-label'},el('span',{class:'status-dot '+value}),STATUSES[value]);
const relativeTime = value => {
  const elapsed = Math.max(0,Date.now()-new Date(value).valueOf());
  if (!Number.isFinite(elapsed)) return 'Unknown date';
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return Math.floor(elapsed/60_000)+'m ago';
  if (elapsed < 86_400_000) return Math.floor(elapsed/3_600_000)+'h ago';
  return Math.floor(elapsed/86_400_000)+'d ago';
};
let storage;
try { storage = window.localStorage; } catch { /* The workspace still works for this session. */ }
const loaded = loadWorkspace(storage);
let state = loaded.state;
let persistenceAvailable = !!storage && loaded.reason !== 'unavailable';
const views = { overview:'Overview', tickets:'Tickets', 'pull-requests':'Pull requests', projects:'Projects', activity:'Activity', github:'GitHub' };
let view = Object.hasOwn(views,location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let layout = 'board', prFilter = 'open', activeTicket = null, activePR = null;
let filters = { query:'',projectId:'',status:'',priority:'' };
const client = createGitHubClient();
let repository = DEFAULT_REPOSITORY;
try { repository = parseRepository(storage?.getItem('relay.github.repository') || DEFAULT_REPOSITORY); } catch { /* Ignore a damaged preference. */ }
let live = null, liveLoading = false, liveError = '', liveTab = 'issues', liveController, detailController;
let toastTimer;
function toast(message, error = false) {
  const node = $('#toast') || toastNode;
  const openDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  (openDialog || document.body).append(node);
  node.style.left = openDialog ? '50%' : '';
  node.textContent = message; node.className = 'toast'+(error?' error':''); node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>{node.hidden=true;},5500);
}
const toastNode = $('#toast');
function attempt(action) { try { return action(); } catch (error) { render();toast(error.message,true);return null; } }
function commit(next, message) {
  persistenceAvailable = saveWorkspace(storage,next); state = next; render();
  toast(message+(persistenceAvailable?'':' Changes are saved for this session only.'));
}
function setMenu(open) {
  $('#sidebar').classList.toggle('open',open); $('#sidebar-overlay').hidden=!open; $('#menu-button').setAttribute('aria-expanded',String(open));
  if (open) $('#sidebar .nav-item.active')?.focus(); else $('#menu-button').focus({preventScroll:true});
}
function closeDetails() {
  detailController?.abort();
  for (const id of ['ticket-detail','pr-detail','github-detail']) $('#'+id).close();
}
function navigate(next) {
  closeDetails(); if ($('#sidebar').classList.contains('open')) setMenu(false);
  if (location.hash !== '#'+next) location.hash=next;
  view=next; render();
  if (next==='github' && !live && !liveLoading) connectRepository(repository);
}
function showProject(id) { filters={query:'',projectId:id,status:'',priority:''}; $('#global-search').value=''; navigate('tickets'); }
function renderSidebar() {
  const totals=metrics(state);
  const nav=(id,symbol,count)=>el('a',{href:'#'+id,class:'nav-item'+(view===id?' active':''),'aria-current':view===id?'page':null,onclick:event=>{event.preventDefault();navigate(id);}},icon(symbol),views[id],count!==undefined && el('span',{class:'nav-count'},count));
  $('#sidebar').replaceChildren(
    el('a',{href:'#overview',class:'brand',onclick:event=>{event.preventDefault();navigate('overview');}},el('span',{class:'brand-mark'},icon('relay')),'relay'),
    el('div',{class:'workspace-switch'},el('span',{class:'workspace-icon'},'N'),el('div',{},el('strong',{},'Northstar Studio'),el('small',{},'Sample workspace'))),
    el('p',{class:'side-label'},'WORKSPACE'),
    el('nav',{class:'nav-group','aria-label':'Main navigation'},nav('overview','overview'),nav('tickets','tickets',totals.open),nav('pull-requests','pr',state.pullRequests.filter(p=>p.state==='open').length),nav('projects','projects'),nav('activity','activity'),nav('github','github')),
    el('div',{class:'side-projects'},el('p',{class:'side-label'},'YOUR PROJECTS'),state.projects.map(p=>el('button',{class:'nav-item',onclick:()=>showProject(p.id)},el('span',{class:'project-dot '+p.color}),p.name))),
    el('div',{class:'sidebar-bottom'},el('a',{class:'nav-item',href:'./pipeline.html'},icon('spark'),'Real CI/CD',icon('external')),
      el('div',{class:'demo-note'},el('strong',{},'A little workspace. A full story.'),'Sample changes '+(persistenceAvailable?'save in this browser.':'last for this session.'),el('br'), 'Live repository data is in GitHub.',
        button('Reset sample data',()=>$('#reset-dialog').showModal(),'reset-link')),
      el('div',{class:'side-user'},avatar('alex'),el('div',{},'Alex Morgan',el('small',{},'Sample account'))))
  );
}
function pageHeading(title,description,actions) {
  return el('div',{class:'page-heading'},el('div',{},el('h1',{},title),el('p',{},description)),el('div',{class:'heading-actions'},actions));
}
function panelHeading(title,action,label='View all') {
  return el('div',{class:'panel-heading'},el('h2',{},title),action && button(label,action,'text-button','arrow'));
}
function ticketRow(ticket) {
  return el('div',{class:'ticket-row'},el('span',{class:'status-dot '+ticket.status}),el('div',{class:'ticket-info'},
    el('div',{class:'ticket-key'},ticket.id),button(ticket.title,()=>openTicket(ticket.id),'ticket-link')),priority(ticket.priority),avatar(ticket.assigneeId,true));
}
function projectCard(p, expanded=false) {
  const tickets=state.tickets.filter(t=>t.projectId===p.id),done=tickets.filter(t=>t.status==='done').length;
  const percent=tickets.length?Math.round(done/tickets.length*100):0;
  return el('article',{class:'project-card'},
    el('div',{class:'project-card-top'},el('span',{class:'project-icon '+p.color},icon(p.icon)),avatar(p.leadId,true)),
    el('h3',{},p.name),el('p',{},tickets.length+' tickets · '+state.pullRequests.filter(pr=>pr.projectId===p.id&&pr.state==='open').length+' open PRs'),
    expanded && el('p',{class:'project-description'},p.description),expanded && el('code',{class:'project-repository'},p.repository+' · fictional'),
    el('div',{class:'project-progress'},el('span',{},done+' of '+tickets.length+' complete'),el('span',{},percent+'%')),
    el('div',{class:'progress-track',role:'progressbar','aria-label':p.name+' completion','aria-valuenow':percent,'aria-valuemin':0,'aria-valuemax':100},el('div',{class:'progress-fill '+p.color,style:'width:'+percent+'%'})),
    button('View project',()=>showProject(p.id),'text-button','arrow'));
}
function activityRow(event) {
  return el('div',{class:'activity-row'},avatar(event.actorId,true),el('div',{class:'activity-detail'},
    el('strong',{},event.actorId==='agent'?'Relay agent':person(event.actorId)?.name || 'Teammate'),
    button(event.message,()=>event.targetType==='pr'?openPR(event.targetId):openTicket(event.targetId),'ticket-link')),
    el('time',{datetime:event.at,title:new Date(event.at).toLocaleString()},relativeTime(event.at)));
}
function reviewCard(pr) {
  return el('article',{class:'review-card'},el('div',{class:'review-card-header'},icon('pr'),project(pr.projectId).name,' / #'+pr.number),
    button(pr.title,()=>openPR(pr.id),'ticket-link'),el('div',{class:'review-card-footer'},badge(pr.review),avatar(pr.authorId,true)));
}
function overview() {
  const totals=metrics(state),urgent=state.tickets.filter(t=>t.status!=='done'&&['urgent','high'].includes(t.priority)).sort((a,b)=>(a.priority==='urgent'?-1:0)-(b.priority==='urgent'?-1:0)).slice(0,5);
  return [
    pageHeading('Your work, connected.','A clear view of what’s moving, what needs you, and what’s next.',el('span',{class:'source-pill'},el('span',{class:'dot'}),'FICTIONAL SHOWCASE')),
    el('section',{class:'stats-grid','aria-label':'Workspace totals'},
      [['Open tickets',totals.open,'Across your sample projects','tickets'],['Needs review',totals.review,'Waiting on an agent review','pr'],['PRs merged',totals.merged,'From idea to delivered','check'],['Active projects',totals.projects,'One shared workspace','projects']].map(([title,count,caption,symbol])=>
        el('article',{class:'stat-card'},el('div',{class:'stat-label'},title,icon(symbol)),el('div',{class:'stat-number'},count),el('div',{class:'stat-caption'+(symbol==='check'?' good':'')},caption)))),
    el('div',{class:'overview-grid'},
      el('section',{class:'panel'},panelHeading('Priority inbox',()=>{filters={query:'',projectId:'',status:'',priority:'high'};navigate('tickets');}),urgent.map(ticketRow)),
      el('section',{class:'panel'},panelHeading('Needs your review',()=>navigate('pull-requests')),state.pullRequests.filter(pr=>pr.state==='open'&&pr.review!=='approved').slice(0,2).map(reviewCard),
        totals.review===0 && empty('All caught up','There are no sample PRs waiting for review.'))),
    el('div',{class:'section-heading'},el('h2',{},'Projects at a glance'),button('All projects',()=>navigate('projects'),'text-button','arrow')),
    el('section',{class:'project-grid','aria-label':'Sample projects'},state.projects.map(p=>projectCard(p))),
    el('div',{class:'bottom-grid'},
      el('section',{class:'panel'},panelHeading('Latest activity',()=>navigate('activity')),state.activity.slice(0,3).map(activityRow)),
      el('section',{class:'workflow-banner'},el('span',{class:'banner-icon'},icon('github')),el('h2',{},'The work is real on GitHub.'),el('p',{},'Follow live issues, pull requests, CI checks and agent feedback from a public repository.'),button('Open GitHub workspace',()=>navigate('github'),'text-button','arrow'))),
  ];
}
function selectControl(label,entries,value,onchange,placeholder) {
  const select=el('select',{class:'select','aria-label':label,onchange:event=>onchange(event.target.value)},placeholder!==undefined&&el('option',{value:''},placeholder),entries.map(([key,name])=>el('option',{value:key},name)));
  select.value=value; return select;
}
function segments(options,value,onchange) {
  return el('div',{class:'segments'},options.map(([id,label,symbol])=>el('button',{type:'button','aria-pressed':String(id===value),onclick:()=>onchange(id)},symbol&&icon(symbol),label)));
}
function empty(title,description,action) {return el('div',{class:'empty'},icon('tickets'),el('h2',{},title),el('p',{},description),action);}
function clearFilters(){filters={query:'',projectId:'',status:'',priority:''};$('#global-search').value='';renderMain();}
function ticketCard(t) {
  const linked=state.pullRequests.filter(pr=>pr.ticketId===t.id).length;
  return el('button',{type:'button',class:'ticket-card',draggable:'true','aria-label':t.id+' '+t.title,onclick:()=>openTicket(t.id),
    ondragstart:event=>{event.dataTransfer.setData('text/plain',t.id);event.dataTransfer.effectAllowed='move';}},
    el('div',{class:'ticket-card-top'},el('span',{class:'ticket-key'},t.id),priority(t.priority)),
    el('h3',{},t.title),t.labels.map(label=>el('span',{class:'label'},label)),
    el('div',{class:'ticket-card-footer'},el('span',{class:'card-pr'},linked?icon('pr'):null,linked||''),avatar(t.assigneeId,true)));
}
function ticketsView() {
  const tickets=filterTickets(state,filters);
  return [pageHeading('Tickets','Make the next step clear. Organize, assign, and move work forward.'),
    el('div',{class:'toolbar'},el('div',{class:'filters'},
      selectControl('Filter by project',state.projects.map(p=>[p.id,p.name]),filters.projectId,v=>{filters.projectId=v;renderMain();},'All projects'),
      selectControl('Filter by status',Object.entries(STATUSES),filters.status,v=>{filters.status=v;renderMain();},'All statuses'),
      selectControl('Filter by priority',Object.entries(PRIORITIES),filters.priority,v=>{filters.priority=v;renderMain();},'All priorities'),
      Object.values(filters).some(Boolean) && button('Clear filters',clearFilters,'text-button')),
      segments([['board','Board','board'],['list','List','list']],layout,v=>{layout=v;renderMain();})),
    el('p',{class:'count-summary'},tickets.length+' tickets'+(filters.query?' matching “'+filters.query+'”':'')),
    !tickets.length ? empty('No tickets here','Try another search or clear your filters.',button('Clear filters',clearFilters)) :
    layout==='board' ? el('div',{class:'board','aria-label':'Ticket board'},Object.entries(STATUSES).map(([status,label])=>el('section',{class:'board-column','aria-label':label,
      ondragover:event=>{event.preventDefault();event.currentTarget.classList.add('drop-active');},
      ondragleave:event=>event.currentTarget.classList.remove('drop-active'),
      ondrop:event=>{event.preventDefault();event.currentTarget.classList.remove('drop-active');const id=event.dataTransfer.getData('text/plain');if(state.tickets.some(t=>t.id===id))attempt(()=>commit(updateTicket(state,id,{status}),'Ticket moved.'));}},
      el('div',{class:'column-heading'},el('span',{class:'status-dot '+status}),label,el('span',{class:'column-count'},tickets.filter(t=>t.status===status).length),
        el('button',{class:'icon-button','aria-label':'Add ticket to '+label,onclick:()=>openTicketForm(null,status)},icon('plus'))),
      tickets.filter(t=>t.status===status).map(ticketCard)))) :
    el('div',{class:'panel table-scroll'},el('table',{class:'data-table'},el('thead',{},el('tr',{},['Ticket','Status','Priority','Project','Assignee'].map(text=>el('th',{scope:'col'},text)))),
      el('tbody',{},tickets.map(t=>el('tr',{},el('td',{},el('span',{class:'ticket-key'},t.id),button(t.title,()=>openTicket(t.id),'ticket-link')),el('td',{},statusLabel(t.status)),el('td',{},priority(t.priority)),el('td',{class:'muted'},project(t.projectId).name),el('td',{},avatar(t.assigneeId))))))),
  ];
}
function prsView() {
  const prs=state.pullRequests.filter(pr=>(prFilter==='all'||pr.state===prFilter)&&(!filters.projectId||pr.projectId===filters.projectId));
  return [pageHeading('Pull requests','A clear path from proposed change to shipped work.'),
    el('div',{class:'toolbar'},segments([['open','Open'],['merged','Merged'],['all','All requests']],prFilter,v=>{prFilter=v;renderMain();}),
      selectControl('Filter pull requests by project',state.projects.map(p=>[p.id,p.name]),filters.projectId,v=>{filters.projectId=v;renderMain();},'All projects')),
    el('div',{class:'notice'},'These pull requests are fictional and interactive. Open ',el('a',{href:'#github',onclick:event=>{event.preventDefault();navigate('github');}},'GitHub'),' for real PRs, checks, and review feedback.'),
    !prs.length ? empty('No pull requests here','Try another project or create a PR from a sample ticket.') :
    el('div',{class:'panel table-scroll'},el('table',{class:'data-table'},el('thead',{},el('tr',{},['Pull request','Checks','Agent review','Author'].map(text=>el('th',{scope:'col'},text)))),
      el('tbody',{},prs.map(pr=>el('tr',{},el('td',{},el('span',{class:'ticket-key'},project(pr.projectId).name+' · #'+pr.number+' · '+pr.ticketId),button(pr.title,()=>openPR(pr.id),'ticket-link'),pr.state==='merged'&&badge('merged')),el('td',{},badge(pr.checks)),el('td',{},badge(pr.review)),el('td',{},avatar(pr.authorId))))))),
  ];
}
function renderMain() {
  $('#view-title').textContent=views[view];
  document.title=views[view]+' · Relay';
  const nodes=view==='overview'?overview():view==='tickets'?ticketsView():view==='pull-requests'?prsView():view==='projects'?
    [pageHeading('Projects','Four fictional teams. One connected place to work.'),el('section',{class:'project-grid'},state.projects.map(p=>projectCard(p,true)))]:
    view==='activity'?[pageHeading('Activity','Every sample ticket, review, and merge leaves a trail.'),el('section',{class:'panel'},state.activity.map(activityRow))]:githubView();
  $('#workspace-content').replaceChildren(...nodes);
}
function render() {
  renderSidebar();renderMain();
  if ($('#ticket-detail').open && activeTicket) renderTicketDetail();
  if ($('#pr-detail').open && activePR) renderPRDetail();
}
function drawerHeader(label,dialog) {return el('div',{class:'drawer-header'},el('span',{class:'eyebrow'},label),el('button',{class:'icon-button','aria-label':'Close '+label,onclick:()=>dialog.close()},icon('close')));}
function openTicket(id) { closeDetails();activeTicket=id;renderTicketDetail();$('#ticket-detail').showModal(); }
function renderTicketDetail() {
  const t=state.tickets.find(t=>t.id===activeTicket); if(!t)return;
  const dialog=$('#ticket-detail'),prs=state.pullRequests.filter(pr=>pr.ticketId===t.id);
  const property=(label,entries,value,key)=>el('div',{class:'field'},el('label',{},label),selectControl('Ticket '+label.toLowerCase(),entries,value,v=>attempt(()=>commit(updateTicket(state,t.id,{[key]:v}),'Ticket updated.'))));
  dialog.replaceChildren(drawerHeader(t.id,dialog),el('div',{class:'drawer-body'},el('span',{class:'badge'},project(t.projectId).name),el('h1',{},t.title),
    el('p',{class:'description'},t.description || 'No description yet. Add details to give the team a clear next step.'),
    el('div',{class:'detail-grid'},property('Status',Object.entries(STATUSES),t.status,'status'),property('Priority',Object.entries(PRIORITIES),t.priority,'priority'),
      property('Assignee',[['','Unassigned'],...state.people.map(p=>[p.id,p.name])],t.assigneeId,'assigneeId'),el('div',{class:'field'},el('label',{},'Due date'),el('p',{class:'muted'},t.dueDate||'No due date'))),
    el('div',{class:'detail-actions'},button('Edit ticket',()=>openTicketForm(t.id)),external('Draft on GitHub',issueDraftURL(repository,t,project(t.projectId)))),
    el('p',{class:'detail-note'},'Draft on GitHub opens a prefilled issue. Review and submit it on GitHub to publish.'),
    el('section',{class:'detail-section'},el('h2',{},'Linked pull requests'),
      prs.map(pr=>el('div',{class:'linked-pr'},el('span',{class:'ticket-key'},project(pr.projectId).repository+' #'+pr.number),button(pr.title,()=>openPR(pr.id),'ticket-link'),badge(pr.state),' ',badge(pr.review))),
      !prs.some(pr=>pr.state==='open')&&t.status!=='done'&&button('Create sample pull request',()=>attempt(()=>{const created=createPullRequest(state,t.id);commit(created.state,'Sample PR created.');openPR(created.id);}), 'button','pr'),
      !prs.length&&t.status==='done'&&el('p',{class:'detail-note'},'Reopen this ticket to create a pull request.')),
    el('p',{class:'detail-note',style:'margin-top:25px'},'Sample ticket · Changes stay in this browser.')));
}
function openPR(id) {closeDetails();activePR=id;renderPRDetail();$('#pr-detail').showModal();}
function renderPRDetail() {
  const pr=state.pullRequests.find(pr=>pr.id===activePR);if(!pr)return;
  const dialog=$('#pr-detail'),ready=pr.checks==='passed'&&pr.review==='approved'&&!pr.issue&&!pr.checkFailure;
  const action=(fn,message)=>()=>attempt(()=>commit(fn(state,pr.id),message));
  dialog.replaceChildren(drawerHeader('Pull request #'+pr.number,dialog),el('div',{class:'drawer-body'},badge(pr.state),el('h1',{},pr.title),
    el('p',{class:'detail-note'},project(pr.projectId).repository+' · '+person(pr.authorId).name),
    el('div',{class:'branch mono'},pr.branch+' → main'),el('div',{class:'diff-stats'},pr.files+' files changed',el('span',{class:'added'},'+'+pr.additions),el('span',{class:'removed'},'−'+pr.deletions)),
    el('section',{class:'detail-section'},el('h2',{},'Delivery checks'),el('div',{class:'check-row'},'CI / automated checks',badge(pr.checks)),el('div',{class:'check-row'},'Relay agent / code review',badge(pr.review))),
    pr.issue&&el('div',{class:'finding'},el('h3',{},icon('spark'),pr.issue.severity+' · Agent found a problem'),el('code',{},pr.issue.path+':'+pr.issue.line),el('p',{},pr.issue.message)),
    pr.state==='open'&&el('div',{class:'detail-actions'},button('Run checks',action(runChecks,'Sample checks finished.')),button('Run agent review',action(reviewPullRequest,'Sample review finished.')),
      (pr.issue||pr.checkFailure)&&button('Apply suggested fix',action(applySuggestedFix,'Sample fix applied. Rerun checks and review.'))),
    pr.state==='open'&&el('div',{},el('button',{class:'button primary',disabled:!ready,onclick:action(mergePullRequest,'Sample PR merged. Linked ticket completed.')},icon('pr'),'Merge sample PR'),
      el('p',{class:'detail-note',style:'margin-top:10px'},ready?'Checks passed and the review is approved.':'Passing checks and an approved review are required before merging.')),
    el('section',{class:'detail-section'},el('h2',{},'Linked ticket'),button(pr.ticketId+' · '+state.tickets.find(t=>t.id===pr.ticketId).title,()=>openTicket(pr.ticketId),'ticket-link')),
    el('p',{class:'detail-note',style:'margin-top:25px'},'Demo pull request · Checks and agent responses are simulated. All actions stay in this browser.')));
}
function openTicketForm(id=null,status='todo') {
  closeDetails();
  const current=state.tickets.find(t=>t.id===id),dialog=$('#ticket-form-dialog');
  const field=(label,name,node)=>el('div',{class:'field'},el('label',{for:'form-'+name},label),node);
  const input=(name,type,value,more={})=>el('input',{name,id:'form-'+name,type,value,...more});
  const select=(name,entries,value,disabled=false)=>{const node=el('select',{name,id:'form-'+name,disabled},entries.map(([key,label])=>el('option',{value:key},label)));node.value=value;return node;};
  const form=el('form',{},el('div',{class:'form-fields'},
    field('Title','title',input('title','text',current?.title||'',{required:true,maxlength:120,placeholder:'What needs to happen?',autofocus:true})),
    field('Description','description',el('textarea',{name:'description',id:'form-description',maxlength:2000,placeholder:'Add context, acceptance criteria, or a little detail…'},current?.description||'')),
    el('div',{class:'form-grid'},field('Project','projectId',select('projectId',state.projects.map(p=>[p.id,p.name]),current?.projectId||filters.projectId||state.projects[0].id,!!current)),
      field('Status','status',select('status',Object.entries(STATUSES),current?.status||status)),
      field('Priority','priority',select('priority',Object.entries(PRIORITIES),current?.priority||'medium')),
      field('Assignee','assigneeId',select('assigneeId',[['','Unassigned'],...state.people.map(p=>[p.id,p.name])],current?.assigneeId||'')),
      field('Due date','dueDate',input('dueDate','date',current?.dueDate||'')))),
    el('div',{class:'form-error',id:'form-error',role:'alert'}),
    el('div',{class:'dialog-actions'},button('Cancel',()=>dialog.close()),el('button',{type:'submit',class:'button primary'},current?'Save changes':'Create ticket')));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const data=Object.fromEntries(new FormData(form));if(current)data.projectId=current.projectId;
      const result=current?{state:updateTicket(state,current.id,data),id:current.id}:createTicket(state,data);
      dialog.close();commit(result.state,current?'Ticket saved.':'Ticket created.');openTicket(result.id);
    }catch(error){$('#form-error').textContent=error.message;}
  });
  dialog.replaceChildren(el('div',{class:'modal-heading'},el('h2',{},current?'Edit ticket':'New ticket'),el('button',{class:'icon-button','aria-label':'Close ticket form',onclick:()=>dialog.close()},icon('close'))),
    el('p',{},'Sample workspace · Saved locally. Use “Draft on GitHub” on a ticket to prepare a real issue.'),form);
  dialog.showModal();
}

function githubView() {
  const form=el('form',{class:'repo-form',onsubmit:event=>{event.preventDefault();connectRepository(new FormData(event.currentTarget).get('repository'));}},
    el('div',{class:'field'},el('label',{for:'repository-input'},'Public GitHub repository'),el('input',{id:'repository-input',name:'repository',value:repository,required:true,placeholder:'owner/repository','aria-label':'Public GitHub repository'})),
    el('button',{type:'submit',class:'button primary',disabled:liveLoading},icon('github'),liveLoading?'Connecting…':'Connect repository'),
    button('Refresh',()=>connectRepository(repository,true),'button','refresh'));
  form.querySelector('button:last-child').disabled=liveLoading;
  let status=liveLoading?'Fetching public repository data from GitHub…':liveError|| (live?'Live GitHub data · Refreshed '+new Date(live.fetchedAt).toLocaleTimeString()+' · Refresh to see newer changes.':'Connect a public repository to see live work.');
  if(liveError&&live)status+=' Showing the last successful snapshot for '+live.repository+'.';
  const result=[
    pageHeading('GitHub workspace','Real issues. Real pull requests. The evidence behind every change.',external('Open repository',githubURL(repository))),
    form,el('p',{class:'connection-status'+(liveError?' error':''),role:'status'},status),
    el('div',{class:'notice'},'Public data comes directly from GitHub. Create and edit issues, approve reviews, and merge PRs on GitHub using the links below. This site never asks for an API key.'),
  ];
  if(!live)return [...result,empty(liveLoading?'Connecting to GitHub…':'Your repository belongs here',liveError?'Try again later, or continue exploring the sample workspace.':'Issues, PRs, agent comments and workflow runs appear here.')];
  result.push(el('div',{class:'toolbar github-tabs'},segments([['issues','Issues · '+live.issues.length,'tickets'],['pulls','Pull requests · '+live.pulls.length,'pr'],['runs','Workflow runs','activity']],liveTab,value=>{liveTab=value;renderMain();}),
    external('New GitHub issue',githubURL(live.repository,'/issues/new/choose'),'button small','plus')));
  result.push(el('p',{class:'count-summary'},live.repository+' · Recent data, including closed items. '+(live.limited?'Results are limited to the latest 100 issue/PR records per endpoint. ':'')+'Latest 20 workflow runs.'));
  const items=live[liveTab];
  if(!items.length)return [...result,empty('Nothing here yet','Create an issue on GitHub, then refresh this workspace.')];
  result.push(el('section',{class:'panel','aria-label':'Live GitHub '+liveTab},items.map(item=>{
    if(liveTab==='runs'){
      const runState=item.status==='completed'?item.conclusion:item.status;
      return el('article',{class:'live-card'},icon('activity'),el('div',{class:'live-card-content'},external(String(item.display_title||item.name||'Workflow run'),githubURL(live.repository,'/actions/runs/'+Number(item.id)),'ticket-link'),
        el('div',{class:'live-meta'},item.name||'Workflow',item.head_branch||'',relativeTime(item.created_at))),badge(runState));
    }
    const isPR=liveTab==='pulls',itemState=item.merged_at?'merged':item.state;
    return el('article',{class:'live-card'},icon(isPR?'pr':'tickets'),el('div',{class:'live-card-content'},
      button(String(item.title||'Untitled'),()=>isPR?openLivePR(item.number):openLiveIssue(item),'ticket-link'),
      el('div',{class:'live-meta'},'#'+item.number,'by '+(item.user?.login||'unknown'),relativeTime(item.updated_at),
        (item.labels||[]).slice(0,3).map(label=>el('span',{class:'badge'},label.name)))),badge(itemState));
  })));
  return result;
}
async function connectRepository(value,fresh=false) {
  let next;
  try{next=parseRepository(value);}catch(error){liveError=error.message;renderMain();return;}
  liveController?.abort();const controller=new AbortController();liveController=controller;
  liveLoading=true;liveError='';if(view==='github')renderMain();
  try{
    const snapshot=await client.snapshot(next,{fresh,signal:controller.signal});
    if(controller.signal.aborted)return;
    live=snapshot;repository=next;
    try{storage?.setItem('relay.github.repository',repository);}catch{/* The connection remains usable for this session. */}
  }catch(error){if(!controller.signal.aborted)liveError=error.message;}
  finally{if(!controller.signal.aborted){liveLoading=false;if(view==='github')renderMain();}}
}
function openLiveIssue(issue) {
  closeDetails();const dialog=$('#github-detail');
  dialog.replaceChildren(drawerHeader('GitHub issue #'+issue.number,dialog),el('div',{class:'drawer-body'},badge(issue.state),el('h1',{},issue.title),
    el('p',{class:'detail-note'},live.repository+' · '+(issue.user?.login||'unknown')),
    el('p',{class:'description'},issue.body||'No description provided.'),
    el('div',{class:'detail-actions'},external('Edit or discuss on GitHub',githubURL(live.repository,'/issues/'+issue.number))),
    el('p',{class:'detail-note'},'Real GitHub issue. Changes made on GitHub appear after refreshing this workspace.')));
  dialog.showModal();
}
function liveComment(comment,isReview=false) {
  return el('article',{class:'live-comment'},el('div',{class:'live-comment-header'},el('strong',{},comment.user?.login||'Unknown author'),
    isReview?badge(String(comment.state||'').toLowerCase()):el('span',{},relativeTime(comment.updated_at||comment.created_at))),
    el('p',{},comment.body||'No written feedback.'));
}
async function openLivePR(number) {
  closeDetails();detailController?.abort();const controller=new AbortController();detailController=controller;
  const repo=live.repository,dialog=$('#github-detail');
  dialog.replaceChildren(drawerHeader('GitHub pull request #'+number,dialog),el('div',{class:'drawer-body'},el('h2',{},'Loading checks and review feedback…')));
  dialog.showModal();
  try{
    const detail=await client.pullRequest(repo,number,{signal:controller.signal});
    if(controller.signal.aborted||!dialog.open)return;
    const {pr,reviews,comments,checks,statuses}=detail;
    dialog.replaceChildren(drawerHeader('GitHub pull request #'+number,dialog),el('div',{class:'drawer-body'},
      badge(pr.merged_at?'merged':pr.state),el('h1',{},pr.title),el('p',{class:'detail-note'},repo+' · '+(pr.user?.login||'unknown')),
      el('div',{class:'branch mono'},(pr.head?.ref||'branch')+' → '+(pr.base?.ref||'main')),
      el('div',{class:'detail-actions'},external('Review or merge on GitHub',githubURL(repo,'/pull/'+number))),
      el('section',{class:'detail-section'},el('h2',{},'Checks on '+pr.head.sha.slice(0,7)),
        checks.map(check=>el('div',{class:'check-row'},el('span',{},check.name),badge(check.status==='completed'?check.conclusion:check.status))),
        statuses.map(status=>el('div',{class:'check-row'},el('span',{},status.context),badge(status.state))),
        !checks.length&&!statuses.length&&el('p',{class:'detail-note'},'No checks have been reported for this revision.')),
      el('section',{class:'detail-section'},el('h2',{},'Reviews and agent feedback'),reviews.map(review=>liveComment(review,true)),comments.map(comment=>liveComment(comment)),
        !reviews.length&&!comments.length&&el('p',{class:'detail-note'},'No reviews or conversation comments yet.')),
      detail.limited&&el('p',{class:'detail-note'},'Showing up to 100 entries per category. Open GitHub for the complete history.'),
      el('section',{class:'detail-section'},el('h2',{},'Description'),el('p',{class:'description'},pr.body||'No description provided.')),
      el('p',{class:'detail-note'},'Live API data · Feedback can refer to earlier commits. GitHub is the source of truth for branch protection, review resolution and merge eligibility.')));
  }catch(error){if(!controller.signal.aborted&&dialog.open)dialog.replaceChildren(drawerHeader('GitHub pull request #'+number,dialog),el('div',{class:'drawer-body'},el('p',{class:'description'},error.message),external('Open pull request',githubURL(repo,'/pull/'+number))));}
}
$('#github-detail').addEventListener('close',()=>{if(!$('#github-detail').open)detailController?.abort();});
$('#menu-button').addEventListener('click',()=>setMenu(!$('#sidebar').classList.contains('open')));
$('#sidebar-overlay').addEventListener('click',()=>setMenu(false));
$('#new-ticket').addEventListener('click',()=>openTicketForm());
$('#global-search').addEventListener('input',event=>{
  filters.query=event.target.value;
  if(view!=='tickets'){view='tickets';location.hash='tickets';renderSidebar();}
  renderMain();
});
$('#cancel-reset').addEventListener('click',()=>$('#reset-dialog').close());
$('#confirm-reset').addEventListener('click',()=>{
  $('#reset-dialog').close();filters={query:'',projectId:'',status:'',priority:''};$('#global-search').value='';prFilter='open';
  commit(createSeed(),'Sample workspace reset.');navigate('overview');
});
window.addEventListener('hashchange',()=>{
  const next=location.hash.slice(1);
  if(Object.hasOwn(views,next)&&next!==view){view=next;render();if(view==='github'&&!live&&!liveLoading)connectRepository(repository);}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&$('#sidebar').classList.contains('open'))setMenu(false);
  if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,dialog'))return;
  if(event.key==='/'){event.preventDefault();$('#global-search').focus();}
  if(event.key.toLowerCase()==='n'){event.preventDefault();openTicketForm();}
});
for(const dialog of document.querySelectorAll('dialog')){
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
}
render();
if(view==='github')connectRepository(repository);
if(loaded.reason==='recovered')toast('Saved sample data could not be restored. A fresh workspace is ready.',true);
if(loaded.reason==='unavailable')toast('Storage is unavailable. Changes will last for this session.');
