# TriHatid setup checklist

The app runs as-is. Pages fall back gracefully if the new database columns are missing,
but the new data (plate, permit, arkila, ratings, feedback, SMS) is only saved after step 1.

## 1. Database (required, 2 minutes)
Supabase dashboard -> SQL Editor -> paste `supabase/migration-features.sql` -> Run.
It is safe to run again. (Re-run it after this update: it adds `destination_lat/lng` on `rides`
so Rebook can recompute fares, and `fcm_token` on `profiles` for push notifications.)

## 2. Storage (required for permit / rehistro photos)
Uploads go to the existing `avatars` bucket. Make sure that bucket exists and that signed-in
users are allowed to upload to it. Note: files in it have public links.

## 3. Rates (required before real use)
In `ride-options.html` change FARE_SPECIAL (special trip) and FARE_ARKILA_PER_HOUR
(hourly arkila) to your real LGU/TODA rates.

## 4. SMS (optional, costs money per text)
1. Create an account at semaphore.co and get an API key.
2. Install the Supabase CLI, then from this folder:
   supabase functions deploy send-sms
   supabase secrets set SEMAPHORE_API_KEY=YOUR_KEY SEMAPHORE_SENDER=TriHatid
3. Dashboard -> Database -> Webhooks -> create one on table `sms_outbox`, event INSERT,
   type "Supabase Edge Functions", function `send-sms`.
4. Make sure users have a phone number in their profile (the register form asks for it).
Check `sms_outbox.status` / `error` to see what was sent, skipped or failed.
Without this step everything else still works; no texts are sent.

## 5. Quick test
Book a ride as a passenger and accept it as a driver on two devices. You should hear sounds,
see the driver card with plate/body number, and see the ride in History with Rebook and Rate.


## 6. Merge notes
This build merges the UI refresh with the native-app work (persistent sessions, push notifications,
ordinance fare matrix). Account IDs are shown as a short 8-digit number (display only; the database
still uses the full id). History now lists every trip you book, including rebooked ones still in progress.
