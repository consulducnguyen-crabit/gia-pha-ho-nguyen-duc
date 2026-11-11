# Security requirements — mandatory

1. GitHub Pages publishes **public frontend assets**; never put private genealogical records in repo, `public/`, build outputs or static JSON.
2. Firebase Auth login alone is insufficient: verify `users/{uid}.enabled == true` (or trusted custom claims) in Firestore and Storage rules.
3. Default deny. Unauthenticated or unapproved users cannot read any genealogy data or media.
4. (Admin edits in-app only through the audited, versioned batch in IN_APP_EDIT.md.) Ordinary members may create constrained change requests, but cannot write `persons`, `relations`, `branches`, `users`, `auditLogs`, or approve their own request.
5. Privileged approval is executed by trusted backend with authenticated role verification and idempotent, version-checked operations. Do not trust `role`, `approvedBy`, or `status` sent by client.
6. Account provisioning, role elevation and disabling users are trusted operations; never self-assign admin.
7. Storage rules enforce path ownership, mime/size limits, and role-based access; media metadata must not bypass ACL.
8. For high-risk operations (bulk imports, merging identities, changing lineage), use dry-run, explicit confirmation, backup and audit.
9. Separate Firebase dev/prod projects; production changes require review.
10. Test rules with Firebase Emulator: anonymous, pending, member, editor, approver, disabled user; direct SDK attacks, cross-document access, query filtering, file access.
11. Keep API keys vs secrets distinct: Firebase web config can be public, service-account keys cannot. Security depends on Rules and trusted backend, not obscuring web config.
12. Configure App Check where appropriate as defense-in-depth, not as substitute for authentication and rules.
13. Plan privacy notices, data retention, deletion/correction procedures, export and access audit.

Never deploy permissive placeholder rules to production.
