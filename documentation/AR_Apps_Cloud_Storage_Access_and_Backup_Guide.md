# Cloud Storage, Access Technologies & Backup Design

**Practical reference for AR Apps: LocalTell, Flowra and future applications**  
**AR Apps | Research and architecture guide | 17 October 2026**

> **Scope:** This guide covers the major services relevant to the AR Apps discussion and widely used integration patterns; it is **not an exhaustive directory of every cloud storage company**. Pricing, quotas, developer approvals, available Android integrations and product terms can change. Check current official terms before shipping a provider integration.

## 1. The big picture: five different things

These terms are often mixed up, but they solve different problems:

| Term | Plain-English meaning | LocalTell / Flowra example |
|---|---|---|
| **Cloud storage provider** | Company or server holding files | Dropbox, Google Drive, Koofr, Nextcloud host |
| **Storage API** | A documented interface allowing code to manage cloud files | Dropbox `files/upload` or Drive `files.create` |
| **OAuth 2.0** | A way users authorize an application, usually without giving it their cloud password | Connect Dropbox account |
| **WebDAV** | A common file-management protocol built on HTTP | Upload `.bklt` to a user's Nextcloud server |
| **SDK** | Prebuilt libraries that make APIs/protocols easier to call | Dropbox SDK, MEGA SDK |
| **Android SAF** | System picker for user-authorized documents, including participating cloud providers | Save or select `.bklt` without a cloud API key |

**Key point:** OAuth answers *“who gave permission?”*; an API/WebDAV answers *“how does the app operate on files?”*; an SDK answers *“what library simplifies the implementation?”*. These are not mutually exclusive: an SDK can call an API authenticated by OAuth.

## 2. Manual backup versus automatic backup versus sync

### 2.1 Manual export / restore via Android Storage Access Framework (SAF)

**Manual backup:** LocalTell creates and validates its backup **in memory**, then shows **Backup ready → Save locally / Upload to cloud**. Both choices may use Android's **Create Document** picker; the cloud choice should additionally offer the Android share sheet when a provider does not expose a writable document provider. The user chooses the provider and folder, then completes Save/Upload.

**Manual restore:** The user taps Restore, chooses a `.bklt` file using **Open Document** (from phone storage or a participating cloud provider), sees the preview, then confirms a safe merge. Unsupported cloud apps can use a download-to-device fallback.

SAF does **not** make every installed cloud app available. The app must expose a compatible Android `DocumentsProvider`, support the operation in question and be signed into a usable account. A shared exported document is an alternative. A successful local write may precede a provider's actual cloud upload completion.

SAF create-document actions create a **new document**; they do not overwrite the same existing filename. A provider may append a suffix. Persistent folder access is possible in some cases but must be requested and tested explicitly.

**No provider-specific API registration is needed for this user-driven Android workflow.** This is also why Google Drive and OneDrive may remain choices for manual backup even if AR Apps decides not to integrate their direct APIs.

### 2.2 Direct cloud backup via provider API or WebDAV

The user connects a supported provider once (OAuth, or server address plus app-specific credential). LocalTell can then upload and list files directly without reopening the file picker for each scheduled backup. This requires **internet connectivity**, account permission and implementation of network failures, credential refresh, quotas and storage-full responses. The provider stores the data in the user's account, not in an AR Apps-owned shared bucket unless explicitly designed otherwise.

### 2.3 Two-way synchronization

Sync is not merely “upload the newest file.” Two offline devices can add, rename or delete different records. Safe sync needs stable record IDs, last synced snapshot, cloud revision/ETag, deletion markers or a comparable deletion-history scheme, deterministic merging, conflict preview and conditional writes to avoid overwriting a newer cloud state.

For LocalTell's **30-place limit**, if reconciliation produces 35 unique places, hold the proposed merge, require removal of at least five with user confirmation, and **block additional bookmark saves and sync completion** while the detected conflict is unresolved. Home, Easy, navigation and other non-bookmark app features remain usable. Do not silently evict oldest entries. A newly installed device declining a cloud-data prompt must **not** overwrite the existing cloud backup.

## 3. The underlying technologies explained

### 3.1 REST and HTTP APIs

An **API (application programming interface)** describes permitted programmatic operations. Many cloud file APIs use HTTPS and REST-style endpoints with methods such as GET (read), POST (create/action), PATCH (change), DELETE (remove). The service returns structured responses, often JSON. Cloud APIs may also provide upload sessions, file revisions, scoped permissions and access-rate limits.

**When to use:** provider-specific automatic backup, listing snapshots, metadata checks, token-managed access and precise conflict detection. **Trade-off:** developer registration, vendor-specific code, quotas and policy changes.

### 3.2 OAuth 2.0, PKCE and tokens

OAuth is an **authorization protocol**, not a storage service and not an API pricing model. The user signs in on the provider's trusted page, sees requested permissions, and approves access. Your app receives tokens for approved operations; it should not collect the user's cloud password.

- **Client/app ID:** public registration identity; it is not a password.
- **Client secret:** confidential credential; do not embed in shipped Android binaries or browser JavaScript.
- **PKCE:** Proof Key for Code Exchange; recommended for public clients (mobile apps and browsers) to protect authorization-code exchange.
- **Access token:** bearer credential used for API requests; usually expires.
- **Refresh token:** when supported, lets a client obtain new access tokens without a full interactive login; must be protected.
- **Scopes:** limited rights, ideally only the application's own folder or files.

**Flowra cross-platform:** One *Flowra* Dropbox app registration can generally cover Flowra Android and browser clients with properly configured redirect URIs and PKCE. **LocalTell** is a different product and should use a separate Dropbox registration. Each registered app has its own linked-account approval lifecycle.

### 3.3 WebDAV

**WebDAV = Web Distributed Authoring and Versioning.** It extends HTTP so a remote server behaves like a file repository. Core operations:

| HTTP/WebDAV method | Purpose |
|---|---|
| `PROPFIND` | Query folder contents or file metadata |
| `MKCOL` | Create a folder |
| `PUT` | Upload or replace file bytes |
| `GET` | Download a file |
| `DELETE` | Delete file/folder |
| `MOVE` / `COPY` | Rename/move or copy where supported |

**How connection works:** obtain server URL, username and preferably a revocable **app-specific password** (or supported token); connect over HTTPS; create directories; transfer files. Nextcloud commonly uses paths below `/remote.php/dav/files/{username}/...`. Koofr documents the WebDAV endpoint `https://app.koofr.net/dav/Koofr` and requires an app-specific password. ownCloud also supports WebDAV.

**Advantages:** one general protocol for multiple providers; users can choose their hosting. **Disadvantages:** no universal consumer account picker; credentials and server URLs can confuse users; capabilities, ETag behavior, locking, rate limits and reliability vary by host. “WebDAV is free” means no protocol-licensing charge, **not** that hosting or cloud storage is unlimited or free.

### 3.4 SDKs (software development kits)

An SDK is a collection of libraries, documentation, sample code and sometimes tools that wraps APIs or implements provider protocols. An SDK is **not itself a cloud service** and does not imply free usage. It often provides login helpers, retries, uploads, downloads, errors, and platform-specific integration.

Examples: Dropbox SDK calls the Dropbox API; MEGA maintains a cross-platform SDK with client-side encryption logic. Always review SDK license, platform support, maintenance, binary size, key handling and service requirements.

### 3.5 Android SAF, intents and the share sheet

- `ACTION_CREATE_DOCUMENT`: request the user to **save a new** backup file at a chosen destination.
- `ACTION_OPEN_DOCUMENT`: request access to an **existing** backup file for restore.
- `ACTION_OPEN_DOCUMENT_TREE`: if supported and appropriate, request access to a **directory**; not a guarantee that every cloud provider will allow managed background operations.
- **Android sharesheet:** send a prepared `.bklt` file to an installed app that can receive file attachments, when it is not writable through SAF. Share flows may require user interaction to finish.

These Android features grant limited user-selected access, not permission to list the entire cloud account and not unattended continuous sync.

### 3.6 Browser downloads, uploads and cloud OAuth

An Ionic **web** app can generate a backup as a browser download and restore one selected with a browser file input. It cannot rely on Android SAF. Direct Dropbox OAuth + API access can also support upload/restore on web, subject to browser constraints such as CORS, redirect setup and secure token handling. A browser tab that is closed **cannot be relied upon to run scheduled backups**; useful alternatives are sync-on-open, sync-on-change while active, or a separately authorized background service.

### 3.7 Object storage APIs (Amazon S3 and compatibles)

S3-style storage uses buckets and object keys rather than normal consumer cloud folders. Examples include AWS S3, Backblaze B2 and S3-compatible hosting. These normally **do not provide the user-friendly “connect my personal free cloud account” workflow**. An AR Apps-operated storage bucket introduces developer billing, credential management, per-user isolation and a backend or safe short-lived credential service. These are therefore not first-choice choices for a no-server consumer bookmark backup.

## 4. Provider-by-provider practical comparison

**Legend:** “Manual” means **user-driven picker or provider-app share/download**, not a guaranteed one-tap native integration on every Android phone. “Direct” describes documented options and should be assessed for current licensing, quotas and approval before development.

| Provider / category | Manual file route | Direct access technology | Key notes for AR Apps |
|---|---|---|---|
| **Google Drive** | Android SAF commonly supported | Google Drive REST API + Google OAuth | No direct API integration planned; API quotas and potential over-threshold billing apply at the **project** level. |
| **Dropbox** | SAF where available; provider-app share/upload | Dropbox HTTP API + OAuth 2.0 / PKCE + SDKs | First choice for optional scheduled sync; separate registration per distinct app; current standard API is free, 50 linked accounts trigger production review; users supply their own storage. |
| **Microsoft OneDrive** | SAF/provider-app route where supported | Microsoft Graph + OAuth / SDKs | Included for **manual selection only** per current AR Apps preference; no direct API integration planned. |
| **Koofr** | Provider app or supported picker / upload fallback | WebDAV; also Koofr-specific interfaces | WebDAV requires app-specific password; candidate future optional direct provider. |
| **MEGA** | Provider app upload/download or supported picker | MEGA SDK | More specialized integration involving encrypted client data; not a guaranteed universal SAF target. |
| **Nextcloud** | Android document provider where supported | WebDAV + Nextcloud APIs | Platform/software, not one universal storage company; user chooses hosted provider or self-hosting. |
| **ownCloud** | Android document provider where supported | WebDAV + ownCloud APIs | Similar hosted/self-hosted model, but different software project and capabilities. |
| **pCloud** | Provider-app route; picker if supported | pCloud API + OAuth | A possible future provider; verify current production access terms, SDK support and pricing. |
| **Box** | Provider-app route; picker if supported | Box REST API + OAuth / SDKs | Enterprise-oriented controls; direct access may require review of app/policy limits. |
| **Proton Drive** | Download/upload in the provider's own app/web UI | Provider-specific integrations, subject to public API support | Do not promise a general-purpose public upload API or SAF document provider without testing. |
| **Apple iCloud Drive** | Apple device browser/system file handling; not general Android SAF | Apple ecosystem-specific APIs | Not a first-class general Android cloud destination; web access may be manual only. |
| **S3 / B2 / compatible object storage** | No normal Android personal-storage picker | S3-compatible object APIs / SDKs | Usually developer-operated storage, with separate billing and security design. |

### Storage quotas, limits and pricing: important distinctions

- **Free API access ≠ unlimited free storage.** Dropbox Basic currently offers 2 GB of personal storage; each user remains responsible for the storage capacity of their account.
- **Dropbox approval ≠ paid developer subscription.** Dropbox states its standard API is free for developers; reaching 50 linked users starts a production-review requirement, not a published fee. Development access also has a total linked-account cap and approval timing rules.
- **Google Drive's direct API pricing differs from manual Save As.** Current Drive API documentation sets a no-charge threshold of **400 million quota units per project per day**, with charges above thresholds planned under its 2026 changes and further billing details/notice. Manual SAF file saves do not require AR Apps to register/use the Google Drive API directly.
- **Koofr free accounts offer storage, not an unlimited promise.** The advertised 10 GB free allowance should be reconfirmed when publishing any quota comparison. WebDAV operation may be throttled; host terms apply.
- **Hosted Nextcloud/ownCloud storage varies by the host.** Running your own server may entail server, bandwidth, backup and maintenance costs, even though WebDAV is an open protocol.
- **Other providers:** free quota, transfer bandwidth, API policies, approval and support tiers may change; avoid claiming unlimited usage without a verified official commitment.

## 5. AR Apps folder naming and permissions

**User-selected manual destination:** suggest the readable folder structure:

```text
AR Apps/
  LocalTell/
    Backups/
      LocalTell-17-Oct-2026-08-30PM-A7F2.bklt
```

The user may create/select this folder in the picker. Android SAF cannot guarantee that LocalTell can silently create that precise folder in every provider.

**Dropbox restricted app-folder access:** Dropbox controls the top-level app folder under its own `Apps` area. For least privilege, separate product registrations often result in separate app folders, e.g. `Apps/AR Apps - LocalTell/...` and `Apps/AR Apps - Flowra/...`. Do **not** assume that two independent registrations can both access one shared parent `Apps/AR Apps/`. Cross-product folder sharing would require carefully evaluated permissions and could broaden each app's access.

**Backup extension:** LocalTell accepts **only `.bklt`** for manual backup and restore, and additionally validates content and schema. A renamed arbitrary file is not valid. Flowra should have its **own extension and schema identity** because its health-related data and records are different. Do not transfer LocalTell backups into Flowra or vice versa.

## 6. Suggested UX and state handling

### LocalTell manual backup

1. Tap **Manual Backup**; assemble versioned, validated LocalTell backup bytes.
2. Display **Backup ready** with **Save locally** and **Upload to cloud**.
3. For local: launch Android Create Document in device storage (user chooses location).
4. For cloud: launch the same picker with explanatory instructions; if no writable cloud provider appears, offer **Share backup** to an installed cloud app.
5. Suggest `LocalTell-17-Oct-2026-08-30PM-A7F2.bklt`. Do not report **Cloud backup complete** just because bytes were handed to another app.
6. If cancelled, display cancellation and preserve source data.

### LocalTell manual restore

1. Tap **Manual Restore**, then **Choose backup file**.
2. Open Android document picker; allow user to navigate local or compatible cloud accounts.
3. Enforce `.bklt` filename extension and validate actual bytes, version, app ID, schema, size, required fields, coordinates, identifiers and duplicates.
4. Preview existing, duplicate, new and final counts; default to non-destructive merge.
5. Confirm before applying; do not overwrite user data if invalid, cancelled, or over the 30-place limit.
6. Keep all core location functionality independent of backup/cloud health.

### LocalTell optional Dropbox backup and synchronization

- Opt-in OAuth PKCE connection with restricted permissions.
- Snapshot filenames include a human-readable date/time **and a short random or unique suffix** to prevent collisions.
- Keep **three latest verified, managed snapshots**; retain a temporary additional recovery snapshot **only while a conflict requires it**. Never delete user-created manual files as part of managed retention.
- Upload only when data changed; first read the latest cloud revision, compare to the last synced base, reconcile with deletion history, and conditionally update an active reference. Avoid blind last-writer-wins.
- A detected sync conflict blocks **new bookmark saving and sync completion** until the user resolves it, but **does not lock the entire app**.
- If a different device added new records and the user declines a sync/restore prompt, leave cloud state untouched. Re-prompt appropriately; replacing remote data must be an explicit, separately confirmed action.
- Respect offline operation, rate limits, account storage exhaustion, disabled provider permissions, failed authentication, and revoked tokens.

## 7. Security and privacy checklist

- **User consent:** off by default for automatic backup; explain destination and the types of data uploaded.
- **Minimize data:** Saved Places names, coordinates, timestamps and relevant metadata only; exclude location history, cell IDs, unnecessary identifiers and accounts.
- **Encryption:** `.bklt` is a filename extension, **not encryption**. For sensitive location records—and especially Flowra's menstrual health information—prefer encrypted cloud snapshots with a clear recovery-key strategy. Encryption must not be confused with OAuth or HTTPS transport security.
- **Keys/tokens:** securely store tokens in the app's protected storage; don't log them, include them in backups or embed client secrets in browser/native binaries.
- **Tamper/corruption detection:** check schema and authentication/integrity protection appropriate to the encryption format; never rely on extension alone.
- **Recovery:** preview and confirm destructive actions; retain the previous validated snapshot during upload and conflict resolution.
- **Separation:** LocalTell and Flowra need different schema identifiers, registrations and data-access boundaries.
- **Accuracy in UI:** say **Saved to selected provider** only when reliably confirmed; otherwise say **File handed to provider** or **Awaiting provider upload**.

## 8. Recommended AR Apps implementation order

| Phase | Scope | Dependency |
|---|---|---|
| **Feature 3** | LocalTell Saved Places, `.bklt` local export/import, tested 30-item rules | Existing location code stability |
| **Feature 4A** | Manual `.bklt` Save As / Share / Choose File across compatible local/cloud providers | Feature 3 complete and tested |
| **Feature 4B** | Dropbox connection, scheduled snapshots, three-backup retention, conflict-safe reconciliation | Feature 4A + production-ready OAuth and sync tests |
| **Optional later** | Koofr / Nextcloud / ownCloud connection via WebDAV | Provider-specific UX and credential security review |
| **Flowra adaptation** | Separate Flowra format; browser download/upload + Android picker; optional Dropbox OAuth for web/Android | Privacy, encryption and cross-platform schema design |

**Current preference:** Do not implement direct Google Drive or OneDrive APIs; still permit those services for **manual** user-selected file export/restore if their Android document providers are available.

## 9. Official reference links (reviewed 17 October 2026)

1. [Android Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)
2. [Android document providers](https://developer.android.com/guide/topics/providers/document-provider.html)
3. [Dropbox developer guide / production approval](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide)
4. [Dropbox developer support / standard API price](https://www.dropbox.com/developers/support)
5. [Dropbox OAuth scopes and PKCE](https://dropbox.tech/developers/now-available--scoped-apps-and-enhanced-permissions)
6. [Dropbox Basic personal storage](https://help.dropbox.com/plans/free-trial)
7. [Google Drive API quotas and planned billing](https://developers.google.com/workspace/drive/api/guides/limits)
8. [Koofr WebDAV endpoint and settings](https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/)
9. [Koofr application-specific passwords](https://koofr.eu/help/linking-koofr-with-desktops/how-to-generate-an-application-specific-password-in-koofr/)
10. [Nextcloud WebDAV file operations](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html)
11. [ownCloud WebDAV](https://doc.owncloud.com/server/11.0/classic_ui/files/access_webdav.html)
12. [MEGA SDK](https://github.com/meganz/sdk)
13. [pCloud developer API / OAuth](https://docs.pcloud.com/)

