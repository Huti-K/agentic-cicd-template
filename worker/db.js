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
  async comments(ticketId){const {results}=await this.db.prepare('SELECT id,ticket_id AS ticketId,author_id AS authorId,body,kind,created_at AS createdAt FROM comments WHERE ticket_id=? ORDER BY created_at,id LIMIT 300').bind(ticketId).all();return results;}
  jobRow(row){return row?{...JSON.parse(row.data),id:row.id,ticketId:row.ticket_id,kind:row.kind,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  async job(id){const row=await this.db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();if(!row)throw new HttpError(404,'Agent job not found.');return this.jobRow(row);}
  async jobs(ticketId){const statement=ticketId?this.db.prepare('SELECT * FROM jobs WHERE ticket_id=? ORDER BY created_at DESC LIMIT 40').bind(ticketId):this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100');const {results}=await statement.all();return results.map(row=>this.jobRow(row));}
  async createJob(ticket,kind,baseSha){
    const id=crypto.randomUUID(),at=now(),data={runId:null,runUrl:null,headSha:ticket.headSha||null,baseSha,summary:'Waiting for GitHub Actions',title:ticket.title,description:ticket.description,version:ticket.version,evidence:[]};
    try{await this.db.prepare('INSERT INTO jobs(id,ticket_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,\'queued\',?,?,?)').bind(id,ticket.id,kind,JSON.stringify(data),at,at).run();}
    catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'An agent is already working on this ticket.','job_active');throw error;}
    return this.job(id);
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
  async metadata(key){const row=await this.db.prepare('SELECT value FROM metadata WHERE key=?').bind(key).first();return row?JSON.parse(row.value):null;}
  async setMetadata(key,value){await this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
}
