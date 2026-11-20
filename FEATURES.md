# New features — setup notes

## 1. One-time Supabase setup
1. Open the Supabase SQL editor and run `supabase/migration-features.sql` (safe to re-run).
   Until it is run, the app still works: booking, rating and accepting rides fall back to the old columns,
   but plate/body/permit, Arkila details, SMS and feedback are not saved.
2. **SMS (optional but required for real texts):** deploy `supabase/functions/send-sms`, set the secrets
   (`SEMAPHORE_API_KEY`, optional `SEMAPHORE_SENDER`), then add a Database Webhook on INSERT into
   `public.sms_outbox` that calls the function. The example uses Semaphore; swap `sendSms()` for another gateway.
   The Edge Function has not been run against a live gateway.

## 2. What was added
| Feature | Where |
|---|---|
| SMS notification | `notify.js` queues `sms_outbox`; sent on accepted / arriving / trip started / completed. Toggle in `notifications.html` |
| Sound | `notify.js` (generated tones, no audio files): new request, driver found, arriving, message, complete |
| Feedback | `feedback.html` (app feedback) + feedback and quick tags on `rating.html` |
| Details of driver | `driver-info.js`, shown on `passenger-pickup.html`, `on-trip.html`, `profile.html` |
| Plate number | Registration, Edit Profile, driver card (plate badge), history |
| History (rebook) | `home.html` History tab: Rebook and Rate buttons. **Rebook books the same driver**: the ride is reserved (`rides.preferred_driver_id`), only that driver sees it (marked "REQUESTED YOU") and only they can accept it. `ride-options.html` shows who you're rebooking and lets you switch to any driver; `searching.html` waits for them and, after 45 s or if they decline, offers "Find any available driver". Needs the 2b block of `migration-features.sql`; trips saved before driver details existed rebook with any driver. |
| Special (Arkila) | `ride-options.html`: special trip or hourly arkila, passenger count; shown to drivers and in history |
| Rate | Passenger rates driver (stars, tags); driver rates passenger after a trip; average shown on driver card |
| Operator's Permit, Body Number, Rehistro | `register.html`, `edit-profile.html` (with photo upload), `profile.html`, driver dashboard warning if incomplete |
| How to register Grab / Angkas / Joyride | `register-guide.html` (linked from welcome, register and the driver Account tab) |

## 3. Things to review
* Fares for Special/Arkila are placeholders at the top of the script in `ride-options.html`
  (`FARE_SPECIAL = 60`, `FARE_ARKILA_PER_HOUR = 150`). Set them to your LGU/TODA rates.
* The registration guide summarises public information and links to official sites; requirements change, so keep it reviewed.
* Sounds can be blocked by a browser until the user taps the screen once; the in-app alert still shows.

## 4. Latest update
* **Edit Profile save fixed** (`edit-profile.html`): saves to `profiles` with update-then-insert, skips columns the database doesn't have yet, no longer resets a driver's role to passenger, safe file names for uploads, and shows a clear error.
* **Report this passenger** (driver): `report.html` now works for both roles (`?as=driver&ride_id=...`). Links are on the driver pickup card, the on-trip card and the trip-complete rating pop-up. Run the section 5 block of `supabase/migration-features.sql`.
* **Pop-up for passenger** (`passenger-pickup.html`): "The Driver is arriving to your location shortly" appears after the driver accepts.
* **Automatic chat introduction**: "Good day, I'm (Driver name) your Trihatid Driver, on my way to your pickup location." is sent when the driver accepts (`TriChat.sendDriverGreeting` in `notify.js`).

