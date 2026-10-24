import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Direct MCP acceptance, not a simulator conversation. Never print capabilities.
const origin = "https://ami-worker.oluwafemiadeleke13.workers.dev";
const key = (process.env.API_KEY ?? readFileSync(".dev.vars","utf8").match(/^API_KEY=(.+)$/m)?.[1])?.trim().replace(/^(["'])(.*)\1$/,"$2");
assert(key,"A private integration key is required");
const client = new Client({name:"ami-v8-direct-complaint-qa",version:"1.0.0"});
async function call(name:string,args:Record<string,unknown>,isError=false) {
  const response=await client.callTool({name,arguments:args});
  assert.equal(Boolean(response.isError),isError,`Unexpected tool outcome: ${name}`);
  return JSON.parse((response.content as {text:string}[])[0].text);
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+"/mcp"),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));
  const current=(await client.listTools()).tools;
  const baseline=JSON.parse(readFileSync(".wrangler/v8-baseline-tools.json","utf8")) as typeof current;
  assert.equal(baseline.length,20); assert.equal(current.length,21);
  for(const tool of baseline) assert.deepEqual(current.find(t=>t.name===tool.name),tool,`Prior definition changed: ${tool.name}`);
  const opened=await call("open_demo_profile",{demo_profile_id:"demo_seun_a204",confirmed:true});
  const session={session_token:opened.session_token};
  assert.equal((await call("get_my_profile",session)).unit_id,"A204");
  const incidentReferences=["CMP-10c99a1c-cc51-41fe-a6ea-0dcfa7dd5774","CMP-c80558c7-6edd-4e61-bb88-56750a7f9742"];
  for(const complaint_id of incidentReferences) {
    const record=await call("get_complaint_status",{...session,complaint_id});
    assert.equal(record.found,true); assert.equal(record.complaint_id,complaint_id); assert.equal(record.unit_id,"A204");
  }
  // Persist the non-authorizing request key before a write, so an interrupted QA
  // run recovers the same confirmed demo request instead of creating another row.
  let request_key: string;
  try { request_key=readFileSync(".wrangler/v8-complaint-request-key.txt","utf8").trim(); }
  catch { request_key="v8-direct-qa-"+crypto.randomUUID(); writeFileSync(".wrangler/v8-complaint-request-key.txt",request_key,{mode:0o600}); }
  const input={...session,category:"other",description:"V8 direct backend QA: neighbours keep parking in my allocated parking spot.",idempotency_key:request_key};
  const created=await call("create_complaint",input);
  assert(/^CMP-[a-f0-9-]{36}$/.test(created.complaint_id));
  // Treat the original response as uncertain and recover by key before retrying.
  const recovered=await call("get_complaint_status",{...session,request_key});
  assert.equal(recovered.complaint_id,created.complaint_id);
  const retry=await call("create_complaint",input);
  assert.equal(retry.created,false); assert.equal(retry.complaint_id,created.complaint_id);
  const bills=await call("get_my_invoices",session);
  assert(bills.invoices.length>0);
  const again=await call("get_complaint_status",{...session,complaint_id:created.complaint_id});
  assert.equal(again.found,true);
  const other=await call("open_demo_profile",{demo_profile_id:"demo_ada_c302",confirmed:true});
  assert.equal((await call("get_complaint_status",{session_token:other.session_token,complaint_id:created.complaint_id})).found,false);
  assert.equal((await call("get_complaint_status",{session_token:other.session_token,request_key})).found,false);
  const forged=await call("get_complaint_status",{session_token:"forged-complaint-capability",complaint_id:created.complaint_id},true);
  assert.equal(forged.error,"SESSION_EXPIRED");
  const invalid=await call("get_complaint_status",session,true);
  assert.equal(invalid.error,"INVALID_INPUT");
  const rest=await fetch(origin+"/v1/complaints/"+created.complaint_id,{headers:{Authorization:`Bearer ${key}`,"X-Demo-Session":session.session_token}});
  assert.equal(rest.status,200); assert.equal(rest.headers.get("cache-control"),"no-store");
  assert.equal((await rest.json() as any).complaint_id,created.complaint_id);
  const result={source:"direct MCP; no Chord simulator invoked",tools:current.length,unchanged_definitions:baseline.length,
    incident_references_found:incidentReferences,complaint_id:created.complaint_id,request_key,status:created.status,
    initial_created:created.created,retry_created:retry.created,read_recovery:true,wrong_account_denied:true,forged_session_denied:true,
    same_session_invoice_read:true,rest_read:true};
  writeFileSync(".wrangler/v8-complaint-qa.json",JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result));
} finally {await client.close();}
