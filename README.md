# 🏨 Margalla House — Smart Hotel Management System

**A full-stack hotel management & online reservation platform** — public hotel website, real-time room booking, a complete admin dashboard, automated workflows, and an **AI voice receptionist**, all running on one central database.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-margalla--house--hotel.netlify.app-success?style=for-the-badge)](https://margalla-house-hotel.netlify.app/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20%2F%20PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![n8n](https://img.shields.io/badge/Automation-n8n-EA4B71?style=for-the-badge&logo=n8n&logoColor=white)](https://n8n.io/)
[![ElevenLabs](https://img.shields.io/badge/Voice%20AI-ElevenLabs-black?style=for-the-badge)](https://elevenlabs.io/)
[![Stripe](https://img.shields.io/badge/Payments-Stripe%20(test%20mode)-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://stripe.com/)

> 🌐 **Live website:** https://margalla-house-hotel.netlify.app/

---

## 📂 What's in This Repository

| Folder / File | Contents |
|---|---|
| [`website/`](website/) | The complete static website source — guest site (`index.html`), admin dashboard (`admin/`), and all assets (`assets/`: `site.js`, `admin.js`, `voice.js`, `calendar.js`, `core.js`, `config.js`, styles and brand marks). Deployed live on Netlify. |
| [`n8n/hotel-booking-workflow.json`](n8n/hotel-booking-workflow.json) | The complete n8n automation workflow — **223 nodes**: AI booking agents, Supabase tools, Stripe payment + webhook handling, Google Calendar sync, Gmail notifications and the voice-agent (Retell/ElevenLabs) tool router. |
| `README.md` | This documentation. |

> 🔒 **Security note:** the workflow export is *sanitized* for public release — the live n8n host and production webhook IDs are replaced with placeholders (`YOUR-N8N-HOST`, `YOUR-WEBHOOK-ID-*`), and no API keys or credentials are included (credentials are name references only). To run it: import the JSON into your own n8n, point the HTTP nodes at your instance, and reconnect your own Supabase / Stripe (test mode) / Gmail / Google Calendar / OpenAI credentials. The website's `config.js` uses Supabase's *publishable* key, which is designed to be public — all data is protected by Row Level Security and validated database functions.

---

## 📖 Overview

Traditionally, guests phone a hotel to ask about rooms, check prices, reserve, modify or cancel bookings, and ask about facilities. **Margalla House automates all of it** — through a modern website and an AI voice assistant — while hotel management runs rooms, reservations, guests, pricing and operations from a single dashboard.

The hotel has **10 rooms across two buildings**, each with its own availability calendar:

| Building | Rooms |
|---|---|
| Main Tower | Rooms 01–05 |
| Garden Wing | Rooms 06–10 |

A major highlight is **database-level booking-conflict prevention**: overlapping reservations are rejected at the database itself, no matter whether the booking comes from the website, the admin panel, or an n8n workflow.

## ✨ Key Features

- 🌐 **Public hotel website** — 9 homepage sections (hero carousel, introduction, featured rooms, amenities, why choose us, special offers, reviews, gallery, contact/booking) plus About, Rooms, room-detail, Contact and booking-confirmation pages
- 🛏️ **Real-time room booking** — per-room availability calendars, date selection, price calculation, guest details and instant booking references
- 🛡️ **No double bookings** — conflict prevention enforced in the database (Supabase/PostgreSQL policies)
- 🖥️ **Full admin dashboard** — CRUD management for bookings, rooms, buildings, floors, guests, pricing, offers, reviews and inquiries, with reports and CSV export
- 🎙️ **AI voice receptionist (ElevenLabs)** — guests check availability, hear prices, book, modify or cancel reservations by speaking naturally
- ⚙️ **n8n automation engine** — booking processing, Stripe payment links, email notifications, Google Calendar sync and manager alerts
- 💳 **Stripe payments** — automated payment-link flow with webhook-driven booking status updates *(configured in test mode; production payments need a separate live configuration)*
- 📧 **Automated emails (Gmail)** — booking, payment, modification and cancellation notifications
- 📅 **Google Calendar sync** — reservation events created, updated and removed automatically

## 🏗️ How It Works

The system runs on five components sharing one central hotel database:

| # | Component | Role |
|---|---|---|
| 1 | **Guest** | Visits the website, checks rooms and makes reservations |
| 2 | **Website / Frontend** | Hotel information, room details, booking calendars and forms (HTML, CSS, JavaScript) |
| 3 | **Supabase Database** | Stores guests, rooms, bookings, prices and availability (PostgreSQL) |
| 4 | **n8n Automation** | Processes bookings, notifications, payments and calendar events |
| 5 | **AI Voice Assistant + Admin** | ElevenLabs voice receptionist for guests; dashboard controls for management |

```
Guest ──► Website ──► Supabase (single source of truth)
              ▲              ▲
              │              │
     ElevenLabs Voice ──► n8n ──► Stripe · Gmail · Google Calendar
                         Admin Dashboard ──► Supabase
```

## 🎙️ AI Voice Receptionist — How a Call Flows

> *"Welcome to Margalla House. I can check room availability, make a booking, or help with one you already have. What can I do for you?"*

1. The guest opens the voice chatbot and speaks through their microphone
2. **ElevenLabs** runs the natural conversation (language understanding by OpenAI models)
3. The agent calls the appropriate **n8n webhook tool**
4. n8n reads/writes **Supabase** (availability, prices, reservations)
5. The result returns and ElevenLabs answers the guest verbally

The assistant can check availability and prices, answer hotel questions, create reservations, and look up, modify or cancel existing bookings.

## 🖥️ Admin Dashboard Modules

| Module | Function |
|---|---|
| Overview | Hotel statistics and summaries |
| Bookings | Manage reservations |
| Rooms | Add, edit and delete rooms |
| Buildings | Manage hotel buildings |
| Floors | Manage floors |
| Guests | Manage customer records |
| Pricing | Manage room prices (incl. seasonal pricing) |
| Offers | Create discounts and special offers |
| Reviews | Approve and manage guest reviews |
| Inquiries | Manage customer messages |
| Reports | View reports and export CSV |

## 🗄️ Database (Supabase / PostgreSQL)

| Entity | Stores |
|---|---|
| Buildings | Hotel building details |
| Floors | Floor information |
| Rooms | Room details and status |
| Guests | Customer information |
| Bookings | Reservation information |
| Room bookings | Room allocation and dates |
| Room images | Room photographs |
| Amenities | Room facilities |
| Seasonal pricing | Date-based prices |
| Offers | Discounts |
| Reviews | Customer feedback |
| Inquiries | Contact messages |
| Services | Hotel services |
| Service orders | Guest service requests |

Row-level security policies and booking-conflict prevention are implemented at the database level.

## 🧭 Complete Guest Booking Journey

1. **Visit** — guest opens the Margalla House website
2. **Select room** — browses the 10 rooms with photos, facilities and prices
3. **Select dates** — picks check-in and check-out
4. **Check availability** — Supabase verifies the room is free for those dates
5. **Calculate price** — the system totals the stay (incl. seasonal pricing)
6. **Enter information** — guest submits their details
7. **Create reservation** — the database issues a unique booking reference
8. **Payment** — n8n generates a Stripe payment link (test mode) and emails it to the guest
9. **Automation** — n8n sends notifications and syncs Google Calendar; Stripe's webhook updates the booking status once paid
10. **Confirmation** — the guest receives booking confirmation and hotel details

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Website interface |
| Supabase | Database and authentication |
| PostgreSQL | Database engine |
| n8n | Workflow automation |
| ElevenLabs | AI voice assistant |
| OpenAI | AI language processing |
| Stripe | Online payments (test mode) |
| Gmail | Email notifications |
| Google Calendar | Reservation scheduling |

## ✅ Advantages

- 24/7 online room booking with real-time availability
- AI-powered voice receptionist for guests who prefer to talk, not click
- Centralized management of the whole hotel from one dashboard
- Automated reservation processing, payments, emails and calendar sync
- Duplicate/overlapping bookings prevented at the database level
- Secure administrator access
- Responsive, customer-friendly website
- Drastically reduced manual front-desk work

## 🎯 Objective

To build an integrated, secure, responsive and intelligent hotel management platform that reduces manual work, improves reservation accuracy, automates communication, and gives both guests and management a convenient experience.

**In simple words:** Margalla House is an intelligent hotel booking and management platform where customers can book rooms online or through an AI voice receptionist, while administrators manage the entire hotel through one dashboard.

---

*Built by [Fahad Ahmed Shanawar](https://github.com/AiwithFahad) — Agentic AI Architect · AI Agents · n8n · RAG · Voice AI*
