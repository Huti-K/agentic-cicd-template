export const PEOPLE = [
  { id:'huti',handle:'huti',name:'Huti',initials:'HK',color:'violet',role:'Maintainer' },
  { id:'davidmikan',handle:'davidmikan',name:'David Mikan',initials:'DM',color:'blue',role:'Contributor' },
  { id:'ai',handle:'ai',name:'Relay AI',initials:'AI',color:'green',role:'Agent' },
];
export const PROJECTS = [{id:'relay',name:'Relay',code:'RLY',color:'violet',description:'The support platform that improves itself.'}];
export const STATUSES = ['new','triaging','ready','implementing','in_review','human_edit','merged','deployed','failed'];
export const PRIORITIES = ['urgent','high','medium','low'];
export const SHA = /^[a-f0-9]{40}$/;
export class HttpError extends Error {
  constructor(status,message,code='request_failed'){super(message);this.status=status;this.code=code;}
}
export const assert = (condition,message,status=400,code='invalid_input') => {if(!condition)throw new HttpError(status,message,code);};
export function text(value,max,label,{optional=false}={}) {
  if(optional&&value===undefined)return '';
  assert(typeof value==='string'&&value.length<=max&&(optional||value.trim().length>0),label+' must be '+(optional?'at most ':'1–')+max+' characters.');
  return value.trim();
}
export function ticketNumber(id){assert(/^RLY-[1-9][0-9]{0,7}$/.test(id),'Invalid ticket identifier.');return Number(id.slice(4));}
export function contributorIds(value=[]) {
  assert(Array.isArray(value)&&value.length<=PEOPLE.length,'Choose valid contributors.');
  assert(value.every(id=>PEOPLE.some(person=>person.id===id)),'Unknown contributor.');
  return [...new Set(value)];
}
export function tags(value=[]) {
  assert(Array.isArray(value)&&value.length<=12,'Use up to 12 tags.');
  return [...new Set(value.map(tag=>text(tag,32,'Tag')))];
}
export function ticketInput(input,previous) {
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Supply ticket properties.');
  const data={...previous,...input};
  const title=text(data.title,160,'Title'),description=text(data.description,12000,'Description');
  const type=data.type===undefined?'task':data.type,priority=data.priority===undefined?'medium':data.priority,assigneeId=data.assigneeId===undefined?'':data.assigneeId;
  assert(['bug','feature','task'].includes(type),'Choose a valid ticket type.');
  assert(PRIORITIES.includes(priority),'Choose a valid priority.');
  assert(assigneeId===''||PEOPLE.some(p=>p.id===assigneeId&&p.id!=='ai'),'Choose a human assignee.');
  const contributors=contributorIds(data.contributorIds);
  return {title,description,type,priority,assigneeId,tags:tags(data.tags),contributorIds:[...new Set([...contributors,...(assigneeId?[assigneeId]:[])])]};
}
export function mentions(body) {
  const found=new Set();
  // Email addresses and partial handles do not count as a mention.
  for(const match of body.matchAll(/(^|[^A-Za-z0-9_@.+-])@([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g)) {
    const handle=match[2].toLowerCase();const person=PEOPLE.find(p=>p.handle===handle);
    if(person)found.add(person.id);
  }
  return [...found];
}
export function validPath(path) {
  return typeof path==='string'&&path.length<=260&&!/[\x00-\x1f\\?#]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!path.startsWith('/');
}
export function triageResult(result) {
  assert(result&&typeof result==='object','Missing triage result.');
  const description=text(result.description,12000,'Enriched description'),summary=text(result.summary,2000,'Triage summary');
  assert(typeof result.ready==='boolean','Missing readiness decision.');
  assert(Array.isArray(result.acceptanceCriteria)&&result.acceptanceCriteria.length>=1&&result.acceptanceCriteria.length<=20,'Supply 1–20 acceptance criteria.');
  const references=key=>{assert(Array.isArray(result[key])&&result[key].length<=20,'Invalid '+key+' references.');return result[key].map(item=>{assert(item&&typeof item==='object'&&validPath(item.path),'Invalid repository reference.');return {path:item.path,reason:text(item.reason,600,'Reference reason')};});};
  return {description,summary,ready:result.ready,acceptanceCriteria:result.acceptanceCriteria.map(value=>text(value,800,'Acceptance criterion')),files:references('files'),documentation:references('documentation')};
}
export function allowedAgentPath(path) {return validPath(path)&&/^(demo\/[^.].*\.(js|html|css|svg)|tests\/demo\/[^.].*\.test\.js|e2e\/agent\/[^.].*\.spec\.js)$/.test(path)&&!path.split('/').some(part=>part.startsWith('.'));}
export function evidenceResult(entries,repository,headSha,runId) {
  assert(Array.isArray(entries)&&entries.length>=1&&entries.length<=30,'Supply actual evidence artifacts.');
  return entries.map(item=>{
    assert(item&&typeof item==='object','Invalid evidence record.');
    assert(['report','video','screenshot','artifact'].includes(item.kind),'Unknown evidence type.');
    let url;try{url=new URL(item.url);}catch{throw new HttpError(400,'Invalid evidence URL.','invalid_input');}
    const prefix='/'+repository+'/actions/runs/'+runId+'/artifacts/';
    assert(url.origin==='https://github.com'&&url.pathname.startsWith(prefix)&&/^[1-9][0-9]*$/.test(url.pathname.slice(prefix.length))&&!url.username&&!url.password,'Evidence must link to this workflow run’s GitHub artifacts.');
    assert(item.headSha===headSha,'Evidence revision does not match the job.');
    return {id:crypto.randomUUID(),kind:'artifact',title:text(item.title,160,'Evidence title'),url:url.href,headSha};
  });
}
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function equalSecret(left,right) {
  if(typeof left!=='string'||typeof right!=='string'||!right.length)return false;
  const a=await sha256(left),b=await sha256(right);let different=0;
  for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
