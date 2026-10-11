import { HttpError, ticketNumber } from './model.js';
export const now = () => new Date().toISOString();
export class Store {
  constructor(db){this.db=db;}
  async listTickets(){const {results}=await this.db.prepare('SELECT * FROM tickets ORDER BY number DESC LIMIT 200').all();return results.map(row=>this.ticketRow(row));}
  ticketRow(row){return row?{...JSON.parse(row.data),id:'RLY-'+row.number,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  async ticket(id){const row=await this.db.prepare('SELECT * FROM tickets WHERE number=?').bind(ticketNumber(id)).first();if(!row)throw new HttpError(404,'Ticket not found.');return this.ticketRow(row);}
  async create(data){const at=now();const row=await this.db.prepare('INSERT INTO tickets(data,created_at,updated_at) VALUES(?,?,?) RETURNING *').bind(JSON.stringify(data),at,at).first();return this.ticketRow(row);}
  async update(ticket,changes){
    const merged={...ticket,...changes};delete merged.version;delete merged.id;delete merged.createdAt;delete merged.updatedAt;
    const row=await this.db.prepare('UPDATE tickets SET data=?,version=version+1,updated_at=? WHERE number=? AND version=? RETURNING *').bind(JSON.stringify(merged),now(),ticketNumber(ticket.id),ticket.version).first();
    if(!row)throw new HttpError(409,'This ticket changed. Refresh it before saving again.','version_conflict');return this.ticketRow(row);
  }
  async comment(ticketId,body,authorId='huti',kind='comment'){
    const result={id:crypto.randomUUID(),ticketId,body,authorId,kind,createdAt:now()};
    await this.db.prepare('INSERT INTO comments(id,ticket_id,author_id,body,kind,created_at) VALUES(?,?,?,?,?,?)').bind(result.id,ticketId,authorId,body,kind,result.createdAt).run();return result;
  }
  async appendComment(ticket,body,kind,changes){
    const id=crypto.randomUUID(),at=now(),data={...ticket,...changes,lastCommentId:id};
    for(const key of ['version','id','createdAt','updatedAt'])delete data[key];
    const results=await this.db.batch([
      this.db.prepare('UPDATE tickets SET data=?,version=version+1,updated_at=? WHERE number=? AND version=? RETURNING *').bind(JSON.stringify(data),at,ticketNumber(ticket.id),ticket.version),
      this.db.prepare('INSERT INTO comments(id,ticket_id,author_id,body,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tickets WHERE number=? AND json_extract(data,\'$.lastCommentId\')=?)')
        .bind(id,ticket.id,'huti',body,kind,at,ticketNumber(ticket.id),id),
    ]);
    if(results[0].results.length!==1)throw new HttpError(409,'The discussion changed. Retry this comment.','version_conflict');
    return this.ticketRow(results[0].results[0]);
  }
  async comments(ticketId){const {results}=await this.db.prepare('SELECT id,ticket_id AS ticketId,author_id AS authorId,body,kind,created_at AS createdAt FROM comments WHERE ticket_id=? ORDER BY created_at DESC,id DESC LIMIT 300').bind(ticketId).all();return results.reverse();}
  jobRow(row){return row?{...JSON.parse(row.data),id:row.id,ticketId:row.ticket_id,kind:row.kind,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  async job(id){const row=await this.db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();if(!row)throw new HttpError(404,'Agent job not found.');return this.jobRow(row);}
  async jobs(ticketId){const statement=ticketId?this.db.prepare('SELECT * FROM jobs WHERE ticket_id=? ORDER BY created_at DESC LIMIT 40').bind(ticketId):this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100');const {results}=await statement.all();return results.map(row=>this.jobRow(row));}
  async createJob(ticket,kind,baseSha){
    const id=crypto.randomUUID(),at=now(),data={runId:null,runUrl:null,headSha:ticket.headSha||null,baseSha,summary:'Waiting for GitHub Actions',title:ticket.title,description:ticket.description,version:ticket.version,evidence:[]};
    try{await this.db.prepare('INSERT INTO jobs(id,ticket_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,\'queued\',?,?,?)').bind(id,ticket.id,kind,JSON.stringify(data),at,at).run();}
    catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'An agent is already working on this ticket.','job_active');throw error;}
    return this.job(id);
  }
  async startJob(ticket,kind,baseSha){
    const id=crypto.randomUUID(),at=now();
    const job={runId:null,runUrl:null,headSha:ticket.headSha||null,baseSha,summary:'Waiting for GitHub Actions',title:ticket.title,description:ticket.description,version:ticket.version,evidence:[],consumedPending:ticket.pendingAgent||null,dispatchState:'pending',dispatchUntil:0};
    const data={...ticket,status:kind==='triage'?'triaging':kind==='implement'?'implementing':'in_review',activeJobId:id,pendingAgent:null,error:null,contributorIds:[...new Set([...ticket.contributorIds,'ai'])]};
    for(const key of ['version','id','createdAt','updatedAt'])delete data[key];
    let results;
    try{results=await this.db.batch([
      this.db.prepare('UPDATE tickets SET data=?,version=version+1,updated_at=? WHERE number=? AND version=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE ticket_id=? AND status IN (\'queued\',\'running\')) RETURNING *')
        .bind(JSON.stringify(data),at,ticketNumber(ticket.id),ticket.version,ticket.id),
      this.db.prepare('INSERT INTO jobs(id,ticket_id,kind,status,data,created_at,updated_at) SELECT ?,?,?,\'queued\',?,?,? WHERE EXISTS(SELECT 1 FROM tickets WHERE number=? AND json_extract(data,\'$.activeJobId\')=?) RETURNING *')
        .bind(id,ticket.id,kind,JSON.stringify(job),at,at,ticketNumber(ticket.id),id),
      this.db.prepare('INSERT INTO comments(id,ticket_id,author_id,body,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)')
        .bind(crypto.randomUUID(),ticket.id,'ai',(kind==='triage'?'Triage':kind==='implement'?'Implementation':'Evidence')+' agent queued in GitHub Actions.','event',at,id),
    ]);}catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'An agent is already working on this ticket.','job_active');throw error;}
    if(results[0].results.length!==1||results[1].results.length!==1)throw new HttpError(409,'The ticket changed before its agent could start. Retry the action.','version_conflict');
    return {ticket:this.ticketRow(results[0].results[0]),job:this.jobRow(results[1].results[0])};
  }
  async claimDispatch(job){
    const owner=crypto.randomUUID(),timestamp=Date.now();
    const row=await this.db.prepare('UPDATE jobs SET data=json_set(data,\'$.dispatchOwner\',?,\'$.dispatchUntil\',?),updated_at=? WHERE id=? AND status=\'queued\' AND json_extract(data,\'$.dispatchState\')=\'pending\' AND COALESCE(json_extract(data,\'$.dispatchUntil\'),0)<? AND EXISTS(SELECT 1 FROM tickets WHERE number=? AND json_extract(data,\'$.activeJobId\')=? AND json_extract(data,\'$.status\') NOT IN (\'human_edit\',\'merged\',\'deployed\')) RETURNING *')
      .bind(owner,timestamp+60_000,now(),job.id,timestamp,ticketNumber(job.ticketId),job.id).first();
    return this.jobRow(row);
  }
  async acceptedDispatch(job){
    await this.db.prepare('UPDATE jobs SET data=json_set(data,\'$.dispatchState\',\'accepted\',\'$.dispatchUntil\',0),updated_at=? WHERE id=? AND json_extract(data,\'$.dispatchOwner\')=?')
      .bind(now(),job.id,job.dispatchOwner).run();
  }
  async pauseTicket(ticket){
    const pauseId=crypto.randomUUID(),at=now(),data={...ticket,status:'human_edit',activeJobId:null,pendingAgent:null,error:null,humanPauseId:pauseId};
    for(const key of ['version','id','createdAt','updatedAt'])delete data[key];
    const results=await this.db.batch([
      this.db.prepare('UPDATE tickets SET data=?,version=version+1,updated_at=? WHERE number=? AND version=? RETURNING *').bind(JSON.stringify(data),at,ticketNumber(ticket.id),ticket.version),
      this.db.prepare('UPDATE jobs SET status=\'failed\',data=json_set(data,\'$.summary\',\'Stopped for human editing.\'),updated_at=? WHERE ticket_id=? AND status IN (\'queued\',\'running\') AND EXISTS(SELECT 1 FROM tickets WHERE number=? AND json_extract(data,\'$.humanPauseId\')=?) RETURNING *')
        .bind(at,ticket.id,ticketNumber(ticket.id),pauseId),
    ]);
    if(results[0].results.length!==1)throw new HttpError(409,'The ticket changed before automation could pause. Retry the action.','version_conflict');
    return {ticket:this.ticketRow(results[0].results[0]),jobs:results[1].results.map(row=>this.jobRow(row))};
  }
  async updateJob(job,changes){
    const merged={...job,...changes};const status=merged.status;for(const key of ['id','ticketId','kind','status','createdAt','updatedAt'])delete merged[key];
    const row=await this.db.prepare('UPDATE jobs SET status=?,data=?,updated_at=? WHERE id=? AND status=? RETURNING *').bind(status,JSON.stringify(merged),now(),job.id,job.status).first();
    if(!row)throw new HttpError(409,'The agent job already changed.','job_conflict');return this.jobRow(row);
  }
  async finishJob(job,ticket,jobChanges,ticketChanges,event){
    const at=now(),completionId=crypto.randomUUID();
    const nextTicket={...ticket,...ticketChanges,lastCompletedJobId:job.id,lastCompletionId:completionId};
    for(const key of ['version','id','createdAt','updatedAt'])delete nextTicket[key];
    const nextJob={...job,...jobChanges},status=nextJob.status;
    for(const key of ['id','ticketId','kind','status','createdAt','updatedAt'])delete nextJob[key];
    const number=ticketNumber(ticket.id);
    // D1 batches run as one transaction. The completion nonce makes the second
    // update and event conditional on this attempt actually changing the ticket.
    const results=await this.db.batch([
      this.db.prepare('UPDATE tickets SET data=?,version=version+1,updated_at=? WHERE number=? AND version=? AND json_extract(data,\'$.activeJobId\')=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status=?) RETURNING *')
        .bind(JSON.stringify(nextTicket),at,number,ticket.version,job.id,job.id,job.status),
      this.db.prepare('UPDATE jobs SET status=?,data=?,updated_at=? WHERE id=? AND status=? AND EXISTS(SELECT 1 FROM tickets WHERE number=? AND version=? AND json_extract(data,\'$.lastCompletionId\')=?) RETURNING *')
        .bind(status,JSON.stringify(nextJob),at,job.id,job.status,number,ticket.version+1,completionId),
      this.db.prepare('INSERT INTO comments(id,ticket_id,author_id,body,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tickets WHERE number=? AND json_extract(data,\'$.lastCompletionId\')=?) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status=?)')
        .bind(crypto.randomUUID(),ticket.id,'ai',event.body,event.kind,at,number,completionId,job.id,status),
    ]);
    if(results[0].results.length!==1||results[1].results.length!==1)throw new HttpError(409,'The ticket or agent job changed before the result could be saved. Retry the current job.','stale_job');
    return {ticket:this.ticketRow(results[0].results[0]),job:this.jobRow(results[1].results[0])};
  }
  async rate(key,limit,seconds){
    const timestamp=Date.now(),expires=timestamp+seconds*1000;
    const row=await this.db.prepare('INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN ? ELSE expires_at END RETURNING count').bind(key,expires,timestamp,timestamp,expires).first();
    if(row.count>limit)throw new HttpError(429,'Too many requests. Please wait before trying again.','rate_limited');
  }
  async inbox(){const {results}=await this.db.prepare('SELECT data FROM inbox ORDER BY created_at DESC LIMIT 100').all();return results.map(row=>JSON.parse(row.data));}
  async inboxTicket(key,requestHash,message,properties){
    // Ticket allocation and its inbox association commit together. A retry can
    // also repair an older interrupted reservation using its durable source ID.
    await this.db.batch([
      this.db.prepare('INSERT INTO inbox(id,idempotency_key,request_hash,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING')
        .bind(message.id,key,requestHash,JSON.stringify(message),message.createdAt),
      this.db.prepare('INSERT INTO tickets(data,created_at,updated_at) SELECT json_set(?,\'$.sourceInboxId\',inbox.id),?,? FROM inbox WHERE idempotency_key=? AND request_hash=? AND json_extract(data,\'$.ticketId\') IS NULL AND NOT EXISTS(SELECT 1 FROM tickets WHERE json_extract(tickets.data,\'$.sourceInboxId\')=inbox.id)')
        .bind(JSON.stringify(properties),message.createdAt,message.createdAt,key,requestHash),
      this.db.prepare('UPDATE inbox SET data=json_set(data,\'$.ticketId\',(SELECT \'RLY-\'||number FROM tickets WHERE json_extract(tickets.data,\'$.sourceInboxId\')=inbox.id LIMIT 1)) WHERE idempotency_key=? AND request_hash=? AND json_extract(data,\'$.ticketId\') IS NULL')
        .bind(key,requestHash),
    ]);
    const row=await this.db.prepare('SELECT * FROM inbox WHERE idempotency_key=?').bind(key).first();
    if(row.request_hash!==requestHash)throw new HttpError(409,'This request key was already used with different email content.','idempotency_conflict');
    return JSON.parse(row.data);
  }
  async claimInbox(id){
    const owner=crypto.randomUUID(),timestamp=Date.now();
    const row=await this.db.prepare('UPDATE inbox SET data=json_set(data,\'$.processingOwner\',?,\'$.processingUntil\',?) WHERE id=? AND COALESCE(json_extract(data,\'$.processingUntil\'),0)<? RETURNING data')
      .bind(owner,timestamp+60_000,id,timestamp).first();
    if(!row)throw new HttpError(409,'This email is being processed. Retry with the same key shortly.','request_processing');
    return JSON.parse(row.data);
  }
  async finishInbox(message,complete){
    const row=await this.db.prepare('UPDATE inbox SET data=json_set(data,\'$.processingUntil\',0,\'$.processingComplete\',json(?)) WHERE id=? AND json_extract(data,\'$.processingOwner\')=? RETURNING data')
      .bind(JSON.stringify(complete),message.id,message.processingOwner).first();
    return row?JSON.parse(row.data):message;
  }
  async metadata(key){const row=await this.db.prepare('SELECT value FROM metadata WHERE key=?').bind(key).first();return row?JSON.parse(row.value):null;}
  async setMetadata(key,value){await this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
}
