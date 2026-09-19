---
starter_id: 10x-astro-starter
package_manager: npm
project_name: vetpad
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Vetpad is a small, shared web app with a hard three-week after-hours deadline, so the
stack was chosen to eliminate setup decisions rather than to maximise flexibility. The
10x Astro Starter ships the four things the PRD makes mandatory — real per-person
authentication (a binding external constraint), a relational store for criteria, offers
and attributed notes, server-side routes that can fetch otodom.pl listings and call a
model provider, and a deploy path — as one pinned, opinionated bundle. It passes all
four agent-friendly gates: TypeScript with explicit schemas at boundaries, strong
layout and routing conventions, heavy representation in training data, and current
version-pinned documentation. Supabase's Postgres plus auth covers Access Control
without hand-rolling identity, and its row-level security is the natural home for the
shared-workspace model. Java + Spring Boot was the familiar alternative but supplies no
frontend, which the timeline cannot absorb. The known tension: Cloudflare's edge runtime
is the tightest option for the PRD's ~3-minute audit budget, and Supabase RLS must be
configured early or authorisation gaps accumulate quietly.
