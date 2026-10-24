import {z} from "zod";
import {getPaymentStatusByReference,type PaystackEnv} from "./concierge";
import {validSession} from "./payment-session-store";
export const checkLatestPaymentSchema=z.object({session_token:z.string().min(20).max(256)}).strict();
interface LatestReference {reference:string;invoice_id:string}
export async function checkLatestPayment(env:PaystackEnv,input:unknown) {
  const {session_token}=checkLatestPaymentSchema.parse(input);
  const session=await validSession(env.DB,session_token);
  const direct=await env.DB.prepare(`SELECT a.reference,a.invoice_id FROM payment_session_context pc
    JOIN payment_attempts a ON a.reference=pc.payment_reference AND a.invoice_id=pc.invoice_id AND a.resident_id=pc.tenancy_id
    JOIN invoices i ON i.id=a.invoice_id AND i.resident_id=pc.tenancy_id
    WHERE pc.token_hash=? AND pc.tenancy_id=? LIMIT 1`)
    .bind(session.token_hash,session.tenancy_id).first<LatestReference>();
  const latest=direct??await env.DB.prepare(`SELECT a.reference,a.invoice_id FROM payment_attempts a
    JOIN invoices i ON i.id=a.invoice_id AND i.resident_id=a.resident_id
    WHERE a.resident_id=? AND a.status<>'initializing' ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1`)
    .bind(session.tenancy_id).first<LatestReference>();
  if(!latest) return {found:false as const,payment_status:"not_started" as const,verified_paid:false as const,
    message:"No Paystack test payment attempt is recorded for this resident."};
  const result=await getPaymentStatusByReference(env,session_token,latest.reference);
  return {...result,found:true as const,invoice_id:latest.invoice_id,context_source:direct?"active_session" as const:"resident_history" as const};
}
