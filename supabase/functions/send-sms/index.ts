// Supabase Edge Function: send-sms
// Triggered by a Database Webhook on INSERT into public.sms_outbox.
// Builds the message from the ride, respects the recipient's "SMS notifications" setting,
// and sends it through an SMS gateway. This example uses Semaphore (semaphore.co, Philippines);
// swap sendSms() for Twilio, PhilSMS, etc. if you prefer. NOT TESTED against a live gateway.
//
// Secrets to set:  supabase secrets set SEMAPHORE_API_KEY=... SEMAPHORE_SENDER=TriHatid
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendSms(number: string, message: string) {
  const body = new URLSearchParams({
    apikey: Deno.env.get("SEMAPHORE_API_KEY")!,
    number,
    message,
  });
  const sender = Deno.env.get("SEMAPHORE_SENDER");
  if (sender) body.set("sendername", sender);
  const res = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body });
  if (!res.ok) throw new Error(`SMS gateway ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  const { record } = await req.json();            // the new sms_outbox row
  const mark = (status: string, error?: string) =>
    supabase.from("sms_outbox").update({ status, error: error ?? null }).eq("id", record.id);

  try {
    const { data: ride } = await supabase.from("rides").select("*").eq("id", record.ride_id).maybeSingle();
    const { data: to } = await supabase.from("profiles").select("*").eq("id", record.recipient_id).maybeSingle();
    if (!ride || !to?.phone) { await mark("skipped", "no ride or phone"); return new Response("skipped"); }
    if (to.notify_sms === false) { await mark("skipped", "user opted out"); return new Response("skipped"); }

    const plate = ride.driver_plate ? ` Plate ${String(ride.driver_plate).toUpperCase()}` : "";
    const body = ride.driver_body_no ? `, Body #${ride.driver_body_no}` : "";
    const texts: Record<string, string> = {
      accepted:  `TriHatid: ${ride.driver_name ?? "Your driver"} accepted your ride.${plate}${body}. They are on the way.`,
      arriving:  `TriHatid: Your driver is arriving at your pickup point. Please get ready.`,
      started:   `TriHatid: Your trip has started. Fare: PHP ${ride.fare}.00. Enjoy your ride!`,
      completed: `TriHatid: Trip completed. Total fare: PHP ${ride.fare}.00 (cash). Thank you for riding!`,
      cancelled: `TriHatid: Your ride was cancelled.`,
    };
    const message = texts[record.event];
    if (!message) { await mark("skipped", "unknown event"); return new Response("skipped"); }

    await sendSms(String(to.phone).replace(/[^\d+]/g, ""), message);
    await mark("sent");
    return new Response("sent");
  } catch (e) {
    await mark("failed", String(e));
    return new Response("failed", { status: 500 });
  }
});
