# ADR-0008: Google Workspace Integration (Calendar, Meet, OIDC SSO, Contacts)

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Maintainer, Architect

## Context

Independent photographers and videographers overwhelmingly rely on Google Workspace for custom-domain email (`@studio.com`), day-to-day scheduling, video discovery calls, and contact management on their mobile devices.

Integrating Ownlight with Google Workspace provides significant workflow automation:

1. Studio owners want single sign-on (SSO) with their existing studio Google account.
2. Shoots and consultation meetings booked in the CRM should automatically reflect in Google Calendar, while personal blocks in Google Calendar should prevent CRM double-booking.
3. Client consultation and discovery calls should automatically generate Google Meet video conference links.
4. Client names and phone numbers should optionally sync to Google Contacts so that the photographer's mobile device caller ID recognizes client calls on shoot days.
5. Automated quotes, proposals, and delivery notifications should be sent via the studio's Google Workspace mail infrastructure.

However, Google integrations introduce privacy, third-party data processing (GDPR/DSGVO), and security risks if not architected with least privilege.

## Decision

We will implement a modular, opt-in Google Workspace integration with strict boundary enforcement:

### 1. In Scope for MVP

- **Single Sign-On (OIDC SSO):** Optional "Sign in with Google" via Better-Auth (`TASK-0005`) requesting minimal profile scopes (`openid`, `email`, `profile`).
- **Google Calendar Two-Way Sync (Epic E4):**
  - Synchronizes booked shoots, appointments, and studio blocked times to Google Calendar.
  - Reads free/busy status or primary calendar events to prevent double-booking in public booking widgets.
  - OAuth scope: `https://www.googleapis.com/auth/calendar.events` (minimal event access, never full calendar administration).
- **Google Meet Integration (Epic E4):**
  - When a client books an inquiry or consultation session, the CRM requests a Google Meet conference link via the Calendar API (`conferenceData.createRequest`) and includes the video link in client confirmation emails and portal views.
- **Outgoing Email Sending (Epic E8):**
  - Standard authenticated SMTP or direct Gmail sending for transactional studio notifications (quotes, contracts, gallery links).
- **Google Contacts Sync (Epic E1 - Opt-In):**
  - One-way sync from Ownlight to the photographer's Google Contacts via the Google People API (`contacts` scope). Enables smartphone caller ID on shoot days.

### 2. Explicitly Out of Scope

- **Domain Registration & DNS Management:** Google Domains was discontinued in 2023 and transferred to Squarespace. Domain purchase and DNS record configuration belong at the registrar level (Cloudflare, Hetzner, Strato, Namecheap) and will not be managed inside Ownlight.
- **Google Drive for Gallery/Video Delivery:** Google Drive API rate limits, lack of presigned chunked browser upload URLs, and poor video streaming performance make it unsuitable for high-resolution photo/video galleries. Ownlight will strictly use S3-compatible object storage (MinIO/Garage/Cloudflare R2) for media delivery.
- **Full Two-Way Gmail Inbox Scraping:** Parsing the studio owner's entire inbox into CRM relationship timelines is deferred to post-MVP due to complexity and broad permissions (`gmail.readonly`). MVP tracks outgoing transactional emails sent through the CRM.

### 3. Architecture for Self-Hosted Single Studio

Because Ownlight is self-hosted single-studio, the photographer registers their own **Google Cloud Project** with internal or user-managed OAuth credentials. This gives the studio owner 100% control over their API quotas and completely avoids multi-tenant Google verification and CASA Tier-2/3 security audits.

## Security & Privacy Considerations

- **Strictly Opt-In:** All Google Workspace features are disabled by default. The studio owner must explicitly enable them in `Studio Settings → Integrations → Google Workspace`.
- **Encrypted Token Storage:** Google OAuth access and refresh tokens are stored encrypted at rest using **AES-256-GCM** with the studio master encryption key.
- **Least Privilege:** OAuth scopes are requested per-feature rather than globally (e.g. enabling Calendar does not request Contacts permission).
- **GDPR / DSGVO:**
  - Zero Google client-side JavaScript, trackers, or fonts are loaded in public client portals or inquiry forms. All communication with Google APIs occurs exclusively server-to-server.
  - Photographers operating in the EU/EEA must ensure standard Google Workspace Data Processing Amendments (DPA) and Standard Contractual Clauses (SCCs) are accepted in their Google Workspace admin console.

## Alternatives Considered

- **CalDAV/CardDAV Only:** Evaluated open protocols only. While CalDAV/CardDAV will also be supported (for Apple iCloud and Nextcloud users in E4), Google's proprietary OAuth API is essential because the vast majority of target photographers use Google Workspace.
- **Third-Party Integration Bridges (Zapier/Make):** Rejected as primary solution due to ongoing subscription costs and external data processor leakage for self-hosted users.
