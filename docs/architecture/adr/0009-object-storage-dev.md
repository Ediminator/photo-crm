# ADR-0009: Object storage engine for local development and self-hosting

- Status: Proposed
- Date: 2026-10-09

## Context

Photo CRM is a self-hosted studio management platform for photographers and videographers (ADR-0003). As such, the application must store and serve large digital assets: high-resolution RAW images, client proofing deliverables, full-resolution JPEG galleries, compressed video clips, and generated PDF contracts and invoices.

In line with ADR-0002, storage must be accessible via an S3-compatible API so that the application layer remains completely decoupled from physical disk layout. For local development and out-of-the-box self-hosting, we must supply an S3-compatible storage service in Docker Compose (`compose.dev.yml`).

Recently, changes in the open-source object storage landscape have altered the trade-offs:

1. **MinIO:** Changed license to GNU AGPL v3 in 2021 (compatible with Photo CRM's AGPL v3). In 2023–2024, MinIO ceased publishing public community release notes and security advisories, deprecated standalone gateway mode, restricted several management features to enterprise tiers, and increased its container image size and idle memory footprint (~150–250 MB).
2. **SeaweedFS:** Apache 2.0 licensed, distributed file system with native S3 API layer, optimized for fast handling of billions of small files and large video chunking. Moderate memory footprint (~40–80 MB).
3. **Garage:** AGPL v3 licensed, developed by the French non-profit Deuxfleurs. Purpose-built for lightweight self-hosting across geographically dispersed nodes or modest single-node home servers (Synology NAS, low-cost VPS). Ultra-low memory footprint (<30 MB RAM) and minimal binary footprint.

## Evaluation Matrix

| Criterion                   | MinIO                                                                      | SeaweedFS                                                     | Garage                                                                         |
| :-------------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------- |
| **Licence**                 | AGPL-3.0-or-later                                                          | Apache-2.0                                                    | AGPL-3.0-or-later                                                              |
| **S3 API Fidelity**         | Complete (AWS S3 benchmark gold standard, presigned URLs, multipart)       | High (supports presigned URLs and chunking)                   | Good (S3 subset: buckets, objects, presigned GET/PUT; lacks some ACLs/tagging) |
| **Developer Console**       | Integrated Web UI (port 9001) for visual inspection of buckets and objects | Third-party UI or filer web view                              | CLI-only (no built-in web console)                                             |
| **Dev Compose DX**          | Zero-config single command (`server /data --console-address :9001`)        | Requires master/volume/filer/S3 config or combined entrypoint | Requires multi-step CLI layout or bootstrap script to create keys and buckets  |
| **Resource Usage (Idle)**   | ~150–250 MB RAM                                                            | ~40–80 MB RAM                                                 | ~15–30 MB RAM                                                                  |
| **Self-Hosting (NAS/VPS)**  | High resource usage for low-spec hardware                                  | Excellent performance for photo/video workloads               | Optimal for low-resource hardware and home labs                                |
| **Supply Chain Governance** | Controlled by single commercial entity; closed security tracker            | Active open-source community                                  | Community-driven non-profit (Deuxfleurs)                                       |

## Decision

1. **Local Development (`compose.dev.yml`):** Adopt **MinIO** pinned to a specific stable release (`minio/minio:RELEASE.2025-01-20T14-49-07Z`).
   - _Rationale:_ Local development prioritizes developer velocity and friction-free debugging. MinIO starts with a single CLI argument, requires zero configuration files, and provides an embedded visual Web Console on `127.0.0.1:9001` that allows developers, designers, and UX reviewers to view uploaded assets, check metadata, and verify bucket permissions without third-party desktop tools.

2. **Storage Abstraction in Code:** Implement all object storage operations exclusively using the standard AWS S3 SDK (`@aws-sdk/client-s3`) and standard S3 environment variables (`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET_UPLOADS`).
   - _Rationale:_ By strictly adhering to standard S3 API primitives (standard `PutObject`, `GetObject`, `DeleteObject`, and presigned URLs), self-hosters in production are free to swap MinIO for **Garage** (for resource-constrained Synology NAS or Raspberry Pi setups), **SeaweedFS** (for high-volume commercial photo studios), or managed S3 providers (Hetzner Object Storage, Backblaze B2, Cloudflare R2, AWS S3) simply by modifying `.env`.

3. **Follow-up for Production Self-Hosting (Phase 2):**
   - Provide an optional `compose.garage.yml` overlay for photographers running low-power NAS appliances who need minimal RAM consumption.

## Consequences

- Local developers get a visual console out of the box at `http://localhost:9001`.
- All published ports in `compose.dev.yml` bind strictly to `127.0.0.1` (port 9000 for S3 API, port 9001 for Console).
- No application code will import MinIO-specific client libraries; the codebase interacts exclusively with standard S3 SDKs.
- Secrets are passed exclusively via environment variables (`STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`) with zero hardcoded defaults in compose files.

## Security & Privacy Impact

- **Network Isolation:** MinIO ports are bound strictly to `127.0.0.1` preventing LAN exposure (ASVS V13).
- **Credential Protection:** S3 access key and secret key are enforced to be strong and non-default in `src/env.ts`.
- **Data Sovereignty:** All image data remains 100% self-hosted with no telemetry or external cloud egress by default (GDPR Art. 25).
