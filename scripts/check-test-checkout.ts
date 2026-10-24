import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const origin="https://ami-worker.oluwafemiadeleke13.workers.dev";
const key=(process.env.API_KEY ?? readFileSync(".dev.vars","utf8").match(/^API_KEY=(.+)$/m)?.[1])?.trim().replace(/^(["'])(.*)\1$/,"$2");
assert(key,"Integration key required privately in .dev.vars or environment");
const headers={Authorization:`Bearer ${key}`,"Content-Type":"application/json"};
async function post(path:string,body:unknown) {
  const response=await fetch(origin+path,{method:"POST",headers,body:JSON.stringify(body)});
  assert(response.ok,`Deployment operation failed (${response.status})`);
  return await response.json() as any;
}
const session=await post("/v1/demo/residents",{display_name:"V6 Remote Demo Visitor",property:"palm_heights",confirmed:true,request_key:"v6-remote-visitor-20261024"});
const billsResponse=await fetch(origin+"/v1/invoices",{headers:{...headers,"X-Demo-Session":session.session_token}});
assert(billsResponse.ok);
const bills=await billsResponse.json() as any;
const bill=bills.invoices.find((i:any)=>i.type==="utility");
assert(bill && bill.amount_kobo===235000);
if(process.argv.includes("--initialize")) {
  assert.equal(bill.status,"unpaid","This fictional test invoice is already paid; use --verify to inspect the recorded success.");
  const payment=await post("/v1/payments/initialize",{session_token:session.session_token,invoice_id:bill.invoice_id,confirmed:true});
  assert.equal(payment.environment,"test");
  assert.equal(new URL(payment.checkout_url).hostname,"checkout.paystack.com");
  const meta={checkout_url:payment.checkout_url,invoice_id:bill.invoice_id,reference:payment.reference,amount_kobo:235000,mode:"test"};
  writeFileSync(".wrangler/v6-test-checkout.json",JSON.stringify(meta),{mode:0o600});
  console.log(JSON.stringify(meta));
} else if(process.argv.includes("--verify")) {
  const response=await fetch(origin+"/v1/payments/"+encodeURIComponent(bill.invoice_id),{headers:{...headers,"X-Demo-Session":session.session_token}});
  assert(response.ok,`Server verification failed (${response.status})`);
  const status=await response.json() as any;
  assert.equal(status.verified_paid,true);
  assert.equal(status.invoice.status,"paid");
  const result={verified_paid:status.verified_paid,invoice_status:status.invoice.status,invoice_id:bill.invoice_id,reference:status.reference,amount_kobo:status.invoice.amount_kobo};
  writeFileSync(".wrangler/v6-verified-checkout.json",JSON.stringify(result));
  console.log(JSON.stringify(result));
} else throw new Error("Choose --initialize or --verify; neither mode logs tokens.");
