# Margalla House — Hotel Management System (website + admin)

Static website and admin panel. No build step and no server code — everything talks
directly to your Supabase project (`qpadrgusygbxgtsapewk`), the same database your
n8n workflows use.

```
index.html              Public website (Home, Rooms & Suites, Room details, About, Contact)
admin/login/index.html  Admin sign-in   →  /admin/login/
admin/index.html        Admin dashboard →  /admin/
assets/config.js        Supabase URL + publishable key (public by design; RLS protects data)
assets/core.js          Shared helpers (client, formatting, errors, dialogs)
assets/calendar.js      Per-room live availability calendar
assets/site.js          Public pages, hero carousel, booking flow
assets/admin.js         Dashboard + all CRUD modules
assets/styles.css, assets/admin.css
```

## 1. Deploy (pick one, ~2 minutes)

**Netlify Drop (easiest):** go to https://app.netlify.com/drop and drag the unzipped
folder onto the page. You get a live https URL immediately.

**Vercel:** `npx vercel` inside the folder (choose "Other" / no build command).

**Your existing project:** copy the folder into its `public/` (or static) directory.
Nothing needs installing and no existing files or environment variables are touched.

**Local test only:** `npx serve .` (or `python -m http.server 8080`) inside the folder,
then open http://localhost:8080. Opening index.html by double-click will NOT work —
browsers block the database requests from `file://` pages.

## 2. One Supabase setting after deploying

Supabase → Authentication → URL Configuration → set **Site URL** to your deployed URL
(e.g. `https://your-site.netlify.app`). Login works without it, but password-reset links
use this address.

## 3. Test in your browser (10 minutes)

| # | Do this | You should see |
|---|---|---|
| 1 | Open the site on desktop, then on a phone | Hero carousel with 3 slides, arrows (desktop), swipe (phone), progress dots, pause button |
| 2 | Rooms & Suites | 10 rooms grouped under Building A and Building B; filters work |
| 3 | Open any room | Its own calendar; past days greyed out |
| 4 | Pick dates → Continue → enter details → Confirm booking | Confirmation page with a reference like **B1001** |
| 5 | Open the same room again | Those nights are now hatched (booked) |
| 6 | Try booking overlapping dates on that room (second browser / incognito) | "Sorry! This room is already booked for the selected dates…" |
| 7 | Go to `/admin/` without signing in | Redirected to `/admin/login/` |
| 8 | Sign in: `Admin54321@example.com` / `Admin54321` | Dashboard with live numbers; your test booking in "Recent reservations" |
| 9 | Bookings → Confirm → Check in → Check out on your test booking | Status badge changes each time |
| 10 | Bookings → Cancel the booking, then reload the room page | The nights are free again |
| 11 | Rooms → Photos → upload a JPG; then Remove it | Photo appears on the website; removal deletes it |
| 12 | Contact page → send a message and a review | Appear under Inquiries and Reviews (approve the review → it shows on Home) |
| 13 | Reports → Export CSV | A CSV file downloads |

Cross-platform check: book a room through the n8n chat or voice agent, then open that
room on the website — the dates show as booked. Try the reverse: book on the website,
then ask the chat agent for the same room and dates — it is refused, and if a chat
booking ever slips through to the database it is blocked and an alert email goes to
myroadmap20@gmail.com.

## 4. Before going live

- **Change the admin password** (Supabase → Authentication → Users → admin54321@example.com
  → Send password recovery, or sign in and change it). It has appeared in chat messages
  and in n8n version history.
- Replace sample content: hotel name ("Margalla House" — search & replace), address,
  phone, room prices (Admin → Pricing), and room photos (Admin → Rooms → Photos).
- Supabase → Authentication → enable **Leaked password protection**.
- Optional: delete the 1×1 test image in Supabase → Storage → room-images → TEST folder.

## Voice concierge (ElevenLabs)

A branded voice assistant sits on every public page (bottom-right button, plus buttons on
Home, Contact and each room). It connects to ElevenLabs agent
`agent_3901m77bra3jeq5v338xapr2chcn` (set in `assets/config.js`). Guests can talk, tap a
suggested question, or type; the transcript appears live. On connect it tells the agent
today's date and which page the guest is on.

For it to work on your deployed site, in the ElevenLabs dashboard for that agent:
1. **Security → make the agent public** (no authentication / signed URL required).
2. **Allowlist** your site's domain (e.g. `your-site.netlify.app`) and `localhost` for testing.
3. Give the agent the **webhook tools** from the ElevenLabs setup guide PDF so it can check
   availability and make/change bookings through n8n — otherwise it can only chat.

The microphone only works on **https** (or http://localhost). If the custom concierge can't
connect, the guest is offered the standard ElevenLabs widget automatically.

Test: open the site → "Talk to our concierge" → allow the microphone → ask
"Which rooms are free this weekend?" → the answer should match the room calendars.

## Performance

- The public catalog (buildings, rooms, photos, amenities, reviews) loads in **one** request
  (`get_public_catalog`) and is cached in the browser for 10 minutes, so repeat visits and
  page changes are instant. Availability and prices are never cached — calendars, quotes and
  bookings always ask the database live.
- Photos are served at the size each screen needs, in AVIF/WebP (≈75% fewer image bytes).
- Scripts load without blocking the page; Chart.js and the voice SDK load only when used.
- Calendars refresh every 45 s while visible and pause when the tab is hidden.
- After changing rooms/prices in the admin panel, guests see the update within 10 minutes
  (or immediately after a hard refresh).

Biggest remaining factor: the database is in the US (us-east-1). If most guests are in
Pakistan/Middle East, a Supabase project in Mumbai (ap-south-1) or Singapore would cut each
round trip by roughly half.

## How double bookings are prevented

1. **Database rule (applies to everyone, including n8n):** an exclusion constraint on
   `bookings` rejects any two non-cancelled bookings for the same room whose nights
   overlap. Check-out day can be the next guest's check-in day.
2. **Atomic booking function** `create_booking` (website + admin): validates input,
   locks the room row so simultaneous requests queue, checks availability, creates the
   guest + booking + room_booking in one transaction.
3. **Live calendars** read `get_room_booked_ranges` (dates only, no personal data) and
   refresh every 30 seconds; the final check always happens in the database.

Cancelling a booking (any channel) frees its dates immediately.
