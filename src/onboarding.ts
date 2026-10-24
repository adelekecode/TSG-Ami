import { z } from "zod";
import { hash, type Env } from "./domain";
import { ApiError } from "./maintenance";

export const findDemoProfilesSchema = z.object({
  name: z.string().trim().max(80).optional(),
}).strict();
export const openDemoProfileSchema = z.object({
  demo_profile_id: z.string().regex(/^demo_[a-z0-9_]{1,64}$/),
  confirmed: z.literal(true),
}).strict();
const DEMO_SESSION_SECONDS = 30 * 60;

function requireDemoMode(env: Env) {
  if (env.DEMO_MODE !== "true")
    throw new ApiError(404, "DEMO_DISABLED", "Sample profile selection is unavailable in this environment.");
  if (!env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") || env.PAYSTACK_SECRET_KEY.length <= 8)
    throw new ApiError(503, "TEST_KEY_REQUIRED", "Sample profiles require a configured Paystack test key. Live keys are blocked.");
}
// Only explicitly enrolled fictional profiles (seeded or created through the gated
// visitor flow) are discoverable. Never query the general resident directory.
const profileQuery = `SELECT d.demo_profile_id, r.preferred_name AS display_name,
  u.property_name, CASE WHEN u.building='' THEN 'Apartment ' || u.id
    ELSE u.building || ' / ' || u.id END AS building_label
  FROM demo_profiles d JOIN tenancies t ON t.id=d.tenancy_id
  JOIN residents r ON r.id=t.resident_id JOIN units u ON u.id=t.unit_id
  WHERE t.active=1 AND u.active=1`;
interface DemoProfile {
  demo_profile_id: string;
  display_name: string;
  property_name: string;
  building_label: string;
}
export async function findDemoProfiles(env: Env, input: unknown) {
  requireDemoMode(env);
  const { name } = findDemoProfilesSchema.parse(input);
  const profiles = name
    ? (await env.DB.prepare(profileQuery + " AND lower(trim(r.preferred_name))=lower(?) ORDER BY d.demo_profile_id LIMIT 5")
      .bind(name).all<DemoProfile>()).results
    : [];
  const sampleProfiles = profiles.length ? [] : (await env.DB.prepare(profileQuery + " ORDER BY d.demo_profile_id LIMIT 5").all<DemoProfile>()).results;
  return { mode: "demo", profiles, sample_profiles: sampleProfiles, requires_confirmation: true };
}
export async function openDemoProfile(env: Env, input: unknown) {
  requireDemoMode(env);
  const { demo_profile_id } = openDemoProfileSchema.parse(input);
  const profile = await env.DB.prepare(profileQuery + " AND d.demo_profile_id=?").bind(demo_profile_id).first<DemoProfile>();
  if (!profile) throw new ApiError(404, "DEMO_PROFILE_NOT_FOUND", "That sample profile is unavailable. Please choose from the current sample profiles.");
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // The INSERT repeats the active-profile check, so a profile deactivated during
  // selection cannot receive a session. Token hashes use the existing capability store.
  const result = await env.DB.prepare(`INSERT INTO sessions(token_hash,tenancy_id,expires_at)
    SELECT ?,t.id,? FROM demo_profiles d JOIN tenancies t ON t.id=d.tenancy_id
    JOIN units u ON u.id=t.unit_id WHERE d.demo_profile_id=? AND t.active=1 AND u.active=1`)
    .bind(await hash(token), now + DEMO_SESSION_SECONDS, demo_profile_id).run();
  if (result.meta.changes !== 1) throw new ApiError(404, "DEMO_PROFILE_NOT_FOUND", "That sample profile is unavailable. Please choose again.");
  return { mode: "demo", session_token: token, expires_in_seconds: DEMO_SESSION_SECONDS,
    profile, message: "Sample profile opened for this conversation. This is fictional account selection, not identity verification. Keep the session token private." };
}

// Adapted from the supplied v6 package; actual resident access is tenancy-scoped.
export type OnboardingEnv = Env;
const nameSchema = z.string().trim().min(2).max(80).regex(/^[^<>\u0000-\u001f\u007f]+$/, "Invalid display name");
const requestKeySchema = z.string().trim().min(16).max(128).regex(/^[a-zA-Z0-9._-]+$/);
export const createDemoResidentSchema = z.object({
  display_name: nameSchema,
  property: z.enum(["cedar_court", "palm_heights"]).default("cedar_court"),
  confirmed: z.literal(true),
  request_key: requestKeySchema,
}).strict();
const hintSchema = (max: number) => z.string().trim().max(max).regex(/^[^<>\u0000-\u001f\u007f]*$/, "Invalid text").optional();
export const startRegistrationSchema = z.object({
  display_name: nameSchema,
  property_hint: hintSchema(120),
  unit_hint: hintSchema(40),
  notes: hintSchema(500),
  confirmed: z.literal(true),
  request_key: requestKeySchema,
}).strict();
export const registrationStatusSchema = z.object({
  registration_token: z.string().min(40).max(160),
}).strict();
const opaqueToken = () => crypto.randomUUID()+crypto.randomUUID();
const stamp = () => new Date().toISOString();
const conflict = () => new ApiError(409, "REQUEST_KEY_CONFLICT", "This request reference was used for different details. Please use a new reference for a new request.");
interface CreatedProfile { demo_profile_id: string; request_fingerprint: string }

/** All business records AND the first resident capability commit together. */
export async function createDemoResident(env: OnboardingEnv, input: unknown) {
  requireDemoMode(env);
  const data = createDemoResidentSchema.parse(input);
  const fingerprint = await hash(JSON.stringify([data.display_name,data.property]));
  const findPrevious = () => env.DB.prepare("SELECT demo_profile_id,request_fingerprint FROM demo_profiles WHERE creation_key=?").bind(data.request_key).first<CreatedProfile>();
  const reopen = async (previous: CreatedProfile) => {
    if (previous.request_fingerprint !== fingerprint) throw conflict();
    return { ...await openDemoProfile(env,{demo_profile_id:previous.demo_profile_id,confirmed:true}), created:false };
  };
  const previous = await findPrevious();
  if (previous) return reopen(previous);
  const random = crypto.randomUUID().replaceAll("-", "");
  const profileId = `demo_generated_${random}`;
  const residentId = `res_demo_${random}`;
  const tenancyId = `ten_demo_${random}`;
  const unitId = `DM-${random.slice(0,10).toUpperCase()}`;
  const propertyName = data.property === "palm_heights" ? "Palm Heights (Demo)" : "Cedar Court (Demo)";
  const token = opaqueToken();
  const expires = Math.floor(Date.now()/1000)+DEMO_SESSION_SECONDS;
  const due = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO units(id,property_name,building,active) VALUES (?,?, 'Demo Apartments',1)").bind(unitId,propertyName),
      env.DB.prepare("INSERT INTO residents(id,preferred_name,email) VALUES (?,?,?)").bind(residentId,data.display_name,`ami-demo+${random}@example.com`),
      env.DB.prepare("INSERT INTO tenancies(id,resident_id,unit_id,onboarding_hash,active) VALUES (?,?,?,?,1)").bind(tenancyId,residentId,unitId,await hash(opaqueToken())),
      env.DB.prepare("INSERT INTO demo_profiles(demo_profile_id,tenancy_id,profile_type,creation_key,request_fingerprint,created_at) VALUES (?,?,'generated',?,?,?)").bind(profileId,tenancyId,data.request_key,fingerprint,stamp()),
      // Reuse the established rent->invoice trigger for old AND new rent APIs.
      env.DB.prepare("INSERT INTO rent_invoices(id,tenancy_id,amount_minor,paid_minor,currency,due_date) VALUES (?,?,7500000,0,'NGN',?)").bind(`RENT-${random}`,tenancyId,due),
      env.DB.prepare("INSERT INTO invoices(id,resident_id,kind,description,amount_kobo,currency,due_date,status) VALUES (?,?,'utility','Sample electricity bill',235000,'NGN',?,'unpaid')").bind(`ELEC-${random}`,tenancyId,due),
      env.DB.prepare("INSERT INTO sessions(token_hash,tenancy_id,expires_at) VALUES (?,?,?)").bind(await hash(token),tenancyId,expires),
    ]);
  } catch (error) {
    // A unique creation_key can race. The losing D1 batch rolls back in full;
    // validate the winner's ENTIRE request before issuing any capability.
    const winner = await findPrevious();
    if (winner) return reopen(winner);
    const capacity = await env.DB.prepare("SELECT count(*) AS n FROM demo_profiles WHERE profile_type='generated'").first<{n:number}>();
    if ((capacity?.n??0)>=500) throw new ApiError(429,"DEMO_CAPACITY_REACHED","The sample account limit has been reached. Please choose an existing sample profile.");
    throw error;
  }
  return { mode:"demo", created:true, session_token:token, expires_in_seconds:DEMO_SESSION_SECONDS,
    profile:{ demo_profile_id:profileId, display_name:data.display_name, property_name:propertyName, building_label:`Demo Apartments / ${unitId}` },
    message:"A fictional sample tenancy and its invoices were created. Keep the session token private. This is not production identity verification." };
}
interface RegistrationRow { id:string; status:string; request_fingerprint:string }
const REGISTRATION_TOKEN_SECONDS = 86400;
export async function startResidentRegistration(env: OnboardingEnv, input: unknown) {
  requireDemoMode(env);
  const data = startRegistrationSchema.parse(input);
  const fingerprint = await hash(JSON.stringify([data.display_name,data.property_hint??"",data.unit_hint??"",data.notes??""]));
  const findPrevious = () => env.DB.prepare("SELECT id,status,request_fingerprint FROM onboarding_registrations WHERE request_key=?").bind(data.request_key).first<RegistrationRow>();
  const token = opaqueToken();
  const tokenHash = await hash(token);
  const expires = Math.floor(Date.now()/1000)+REGISTRATION_TOKEN_SECONDS;
  const response = (row: RegistrationRow, created:boolean) => ({
    registration_id:row.id,status:row.status,created,registration_token:token,expires_in_seconds:REGISTRATION_TOKEN_SECONDS,access_granted:false,
    message:"Registration request recorded for review. No tenancy was activated, no account access was granted, and no manager notification was sent.",
  });
  const resume = async (row: RegistrationRow) => {
    if (row.request_fingerprint!==fingerprint) throw conflict();
    await env.DB.prepare("INSERT INTO onboarding_registration_sessions VALUES (?,?,?)").bind(tokenHash,row.id,expires).run();
    return response(row,false);
  };
  const previous = await findPrevious();
  if (previous) return resume(previous);
  const id = `REG-${crypto.randomUUID().replaceAll("-", "").slice(0,14).toUpperCase()}`;
  const timestamp = stamp();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO onboarding_registrations(id,display_name,property_hint,unit_hint,notes,request_key,request_fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)")
        .bind(id,data.display_name,data.property_hint??null,data.unit_hint??null,data.notes??null,data.request_key,fingerprint,timestamp,timestamp),
      env.DB.prepare("INSERT INTO onboarding_registration_sessions VALUES (?,?,?)").bind(tokenHash,id,expires),
    ]);
  } catch (error) {
    const winner = await findPrevious();
    if (winner) return resume(winner);
    const capacity = await env.DB.prepare("SELECT count(*) AS n FROM onboarding_registrations").first<{n:number}>();
    if ((capacity?.n??0)>=500) throw new ApiError(429,"REGISTRATION_CAPACITY_REACHED","Registration intake is full in this demo.");
    throw error;
  }
  return response({id,status:"pending",request_fingerprint:fingerprint},true);
}
export async function getOnboardingStatus(env: OnboardingEnv, rawToken: string) {
  requireDemoMode(env);
  const { registration_token } = registrationStatusSchema.parse({registration_token:rawToken});
  const row = await env.DB.prepare(`SELECT r.id,r.status FROM onboarding_registrations r
    JOIN onboarding_registration_sessions s ON s.registration_id=r.id
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await hash(registration_token),Math.floor(Date.now()/1000)).first<{id:string;status:string}>();
  if (!row) throw new ApiError(404,"REGISTRATION_NOT_FOUND","No registration was found for this lookup session, or the lookup token has expired.");
  return {registration_id:row.id,status:row.status,access_granted:false,
    message:"Registration review and verified account activation are not automated in this exercise."};
}
