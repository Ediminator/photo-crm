# Product Vision

## Problem

Photographers and videographers run their businesses across scattered tools: email for enquiries, spreadsheets for bookings, separate apps for contracts, galleries and questionnaires. Commercial studio CRMs are subscription-locked, usually US-hosted, and store every client's personal data, including wedding dates, home addresses, family details and photos of minors, on third-party infrastructure.

## Vision

**An open-source, self-hosted studio CRM that a photographer can trust with their clients' data and be proud to show their clients.**

- **Own your data.** One instance per studio, running on your own server or a hosting provider of your choice. No telemetry, no trackers, and no third-party calls unless you switch an integration on.
- **Privacy built in.** GDPR/DSGVO and CCPA tooling (consent records, export, erasure, retention) is part of the product, because photographers handle sensitive personal data and images.
- **Made for visual professionals.** A calm, content-first interface, mobile-friendly for life on location, and a client portal that carries the studio's brand.
- **Bilingual from day one.** English and German, with i18n built for more languages.
- **Free forever.** AGPL-3.0-or-later: anyone may use, study, modify and self-host it, and anyone who offers a modified version as a service must share their changes.

## Primary users

| Persona | Needs |
| --- | --- |
| **Solo photographer or videographer** (wedding, portrait, family, event, commercial) | Capture enquiries, book shoots, send proposals and contracts, collect questionnaire answers, deliver galleries, without admin overhead |
| **Their clients** (couples, families, businesses) | A simple, trustworthy portal: review and sign, answer questionnaires, view and download photos, in their language and on any device |
| **Self-hoster or operator** (often the photographer, or a tech-savvy helper) | One-command install, safe defaults, backups, updates |

## Principles (tie-breakers for product decisions)

1. Protect the client's privacy, even when it costs a feature.
2. Keep simple things simple, and leave power features progressive.
3. Make it work on a phone between shoots.
4. Don't add vendor lock-in; use open formats for export.
5. Make it accessible to everyone (WCAG 2.2 AA).

## Non-goals (for now)

Multi-tenant SaaS hosting, invoicing and payments (planned post-MVP with GoBD compliance), team management, native mobile apps, AI image features (no face recognition, ever, without an explicit future decision).
