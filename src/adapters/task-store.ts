/**
 * Legacy Agency Task Store
 *
 * In-memory store for agency tasks with search, filter, and pagination.
 * Used by the REST API (/api/tasks) to list, query, and retrieve tasks.
 */

import{randomUUID}from "node:crypto";

export type AgencyTaskStatus="OPEN"|"IN_PROGRESS"|"DONE"|"BLOCKED";

export interface AgencyTask{id:string;description:string;status:AgencyTaskStatus;assigned?:string;clientName?:string;applicationName?:string;createdAt:string;updatedAt:string;}

export interface AgencyTaskCreateInput{description:string;status?:AgencyTaskStatus;assigned?:string;clientName?:string;applicationName?:string;}

export interface ListOptions{page?:number;limit?:number;status?:string;assigned?:string;q?:string;}

export interface PaginatedResult<T>{data:T[];pagination:{page:number;limit:number;total:number;totalPages:number;};}

export class TaskStore{private tasks:Map<string,AgencyTask>=new Map();
add(input:AgencyTaskCreateInput):AgencyTask{const now=new Date().toISOString();const task:AgencyTask={id:randomUUID(),description:input.description,status:input.status??"OPEN",assigned:input.assigned,clientName:input.clientName,applicationName:input.applicationName,createdAt:now,updatedAt:now};this.tasks.set(task.id,task);return task;}
getById(id:string):AgencyTask|null{return this.tasks.get(id)??null;}
list(opts:ListOptions={}):PaginatedResult<AgencyTask>{const page=Math.max(1,Number(opts.page)||1);const limit=Math.min(100,Math.max(1,Number(opts.limit)||20));let items=Array.from(this.tasks.values());if(opts.status){const s=opts.status.toUpperCase();items=items.filter(t=>t.status===s);}if(opts.assigned){const a=opts.assigned.toUpperCase();items=items.filter(t=>t.assigned?.toUpperCase()===a);}if(opts.q){const k=opts.q.toLowerCase();items=items.filter(t=>t.description.toLowerCase().includes(k));}items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const total=items.length;const totalPages=Math.max(1,Math.ceil(total/limit));const offset=(page-1)*limit;const data=items.slice(offset,offset+limit);return{data,pagination:{page,limit,total,totalPages}};}
clear():void{this.tasks.clear();}size():number{return this.tasks.size;}}

let _defaultStore:TaskStore|null=null;
export function getTaskStore():TaskStore{if(!_defaultStore){_defaultStore=new TaskStore();}return _defaultStore;}
export function _resetTaskStore():void{_defaultStore=null;}
