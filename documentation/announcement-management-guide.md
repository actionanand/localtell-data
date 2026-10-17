# LocalTell — Remote Announcement Configuration Guide

This guide explains how to configure customer announcements in **`localtell-data/announcements/home.json`**. Use the file for supported-country news, upcoming geographic data, temporary download problems, maintenance, downtime, new features, and app migration. Announcements are informational: they **never change, replace, disable, or download geographic data**.

**Configuration file:** [`../announcements/home.json`](../announcements/home.json)  
**Consumed by:** [`local-tell`](https://github.com/actionanand/local-tell) (Android client)  
**Client implementation reference:** [`home-announcements.md`](https://github.com/actionanand/local-tell/blob/master/documentation/home-announcements.md)

> **Client compatibility:** The existing Android `master` announcement parser supports the original schema-version-1 fields, but it does **not yet implement** `repeatPolicy`, `revision`, or `type`. They are the intended backward-compatible extensions for the updated client. Adding them to this JSON alone does not change dismissal or visual behavior in an older installed APK. Verify the client release/branch before relying on those fields. The live Sri Lanka JSON already contains `"repeatPolicy": "every_launch"`.

## 1. How announcements work

1. The Android app reads one static HTTPS JSON document from the URL configured by `homeAnnouncementUrl` in the client's `app-config.json`.
2. It filters announcements by enabled state, publication dates, Android version-code range, and dismissal/repeat rules supported by that client.
3. If multiple messages qualify, it displays **at most one**: highest priority first, then newest `publishedAt`, then alphabetically smallest ID.
4. A customer may close the card. The repeat policy governs whether it is eligible again later.
5. **Once Home or Easy has loaded location/results data, announcements are hidden for that app session.** A critical notice, increased priority, new revision, or later JSON refresh must not interrupt already loaded results.
6. Announcements have no effect on GPS, offline locality lookup, installed packs, downloads, or location sharing. A failing announcement request must not prevent these operations.

**Remote editing is not instant push.** Changes become available after the app next successfully fetches the document, subject to network availability and GitHub/CDN caching. A phone need not receive the change immediately, and a customer already viewing results will not be interrupted.

## 2. Current Sri Lanka announcement

The published file currently has **one announcement** with these settings:

| Property | Published value |
| --- | --- |
| `id` | `sri-lanka-support-2026-10` |
| `repeatPolicy` | `every_launch` |
| `enabled` | `true` |
| `priority` | `100` |
| `publishedAt` | `2026-10-15T00:00:00Z` |
| `expiresAt` | `2027-01-15T00:00:00Z` |
| `minVersionCode` | `30` |
| `action` | `offline_data` |
| `title.en` | `Sri Lanka is now supported` |

Its existing English, Tamil, and Sanskrit messages must remain unchanged unless there is an intentional content update. The published [`home.json`](../announcements/home.json) is the source of truth. **No UAE, outage, maintenance, or migration example below is currently published.**

The intended `every_launch` effect is: appear on a new eligible app launch; hide if dismissed during that session; hide when results load; and become eligible again on a later fresh app launch. Merely unlocking a phone, changing tabs, or recomposing a screen is not a fresh launch.

## 3. JSON structure

A document has two top-level properties:

```json
{
  "schemaVersion": 1,
  "announcements": []
}
```

| Property | Required? | Meaning |
| --- | --- | --- |
| `schemaVersion` | Yes | JSON contract version. **Use `1`.** The current client rejects other versions. Optional new fields may be introduced under version 1 only when implemented compatibly. |
| `announcements` | Yes | Array of announcement objects. An empty array means no announcements. Multiple objects can be scheduled/eligible, but the app presents at most one card at a time. |

### Announcement properties — complete reference

| JSON property | Value and example | What it means / how to use it |
| --- | --- | --- |
| `id` | String: `"sri-lanka-support-2026-10"` | **Required unique ID** for one announcement. Allowed characters: letters, digits, `.`, `_`, `-`; 1–100 characters. Use a *new* ID for a different notice; keep an ID stable when revising the same notice. Duplicate IDs invalidate the document. |
| `enabled` | Boolean: `true` / `false` | **Required.** `true` allows the announcement to qualify; `false` hides it. Use `false` for a draft or to withdraw a message after clients refresh. |
| `priority` | Integer: `100`, `500`, `1000` | Optional; defaults to `0`. **Higher number wins** among otherwise eligible notices. Current supported range is −1,000,000 to 1,000,000. Priority controls ordering, *not* push speed and *not* the results-loaded rule. |
| `publishedAt` | UTC instant: `"2026-12-01T00:00:00Z"` | Optional **start time**. A notice is eligible **at or after** this instant, never before. Omit to allow immediate eligibility once fetched. |
| `expiresAt` | UTC instant: `"2026-12-25T00:00:00Z"` | Optional **end time**. At this instant and afterward the notice is no longer eligible. Omit if no automatic end is desired. If both dates exist, expiry must be later than publication. |
| `minVersionCode` | Nonnegative integer: `30` | Optional **minimum Android build version code, inclusive**. `30` means builds with `versionCode` **30 or greater** qualify; builds 29 and below do not. This is **not** `versionName` (for example, `1.0.30`). Omit to allow all versions from below. |
| `maxVersionCode` | Nonnegative integer: `35` | Optional **maximum Android build version code, inclusive**. `35` means builds with `versionCode` **35 or lower** qualify; 36 and above do not. Omit if there is no upper bound. If both bounds are set, maximum must be at least minimum. |
| `title` | Object: `{"en":"Scheduled maintenance"}` | **Required** localized title. Nonblank English (`en`) is required, with up to **120 characters per supplied language** in the current parser. Optional `ta` and `sa`; missing languages fall back to English. |
| `message` | Object: `{"en":"Please use your installed data."}` | **Required** localized body, with nonblank `en`, up to **600 characters per supplied language** in the current parser. Optional Tamil/Sanskrit translations fall back to English. Use concise, accurate customer-facing language. |
| `action` | `"none"`, `"offline_data"` | Optional button behavior, defaulting to `none`. `offline_data` opens **More → Offline Data**. Unknown action values are treated as `none` by the current client. Future actions must first be safely implemented in the Android app. |
| `repeatPolicy` | `"every_launch"`, `"once_per_revision"` | **Planned updated-client field.** Controls redisplay after dismissal. `every_launch`: eligible again next fresh app launch. `once_per_revision`: a dismissed ID/revision stays dismissed until a higher revision. Existing `master` client currently ignores this property. |
| `revision` | Positive integer: `1`, `2` | **Planned updated-client field.** Version of *this announcement*, **not** the app's version code. Increase it to reannounce a changed message to customers who dismissed an older revision. Proposed default: `1` when omitted. Current `master` client ignores it. |
| `type` | `"general"`, `"feature"`, `"maintenance"`, `"downtime"`, `"migration"`, `"critical"` | **Planned updated-client field.** Describes the notice category for labels/visual styling. Proposed default: `general`. The type is informational and does not execute any action or override results-loaded suppression. Current `master` client ignores it. |

**Localization:** `en` = English, `ta` = Tamil, `sa` = Sanskrit. For example:

```json
"title": {
  "en": "New data is coming",
  "ta": "புதிய தரவு விரைவில் வருகிறது",
  "sa": "नवीनाः दत्तांशाः शीघ्रम् आगमिष्यन्ति"
}
```

Only `en` is mandatory. Keep country names, app name, dates, product names, and geographic identifiers accurate. All remote text is **plain text**, not HTML or Markdown commands. The current JSON document limit is **64 KiB**.

### Choosing a notice type (after the client update)

| `type` | Best use |
| --- | --- |
| `general` | Ordinary service, coverage, or information notice |
| `feature` | Upcoming feature, new feature, or newly supported country |
| `maintenance` | Planned maintenance with a known window |
| `downtime` | Unplanned availability issue, including temporary online geographic-pack download problems |
| `migration` | Moving customers to another app or a new distribution channel |
| `critical` | Important advisory needing visual emphasis; still non-blocking |

### Choosing a repeat policy (after the client update)

| `repeatPolicy` | If the customer closes it | At the next eligible fresh launch | To show it again sooner |
| --- | --- | --- | --- |
| `every_launch` | Hide for this session | Eligible again | Publish a new ID or updated revision; the client must still respect loaded results |
| `once_per_revision` | Remember dismissal for that ID/revision | Remain hidden | Increase `revision` (e.g., `1` → `2`) |

For an announcement with no new fields, the **intended updated-client defaults** are `type: general`, `revision: 1`, and `repeatPolicy: every_launch`. These are design defaults for the planned client changes, **not confirmed behavior in older APKs**. A newly issued message should get a new ID. Do not change revision on every refresh; only increase it when intentionally reannouncing or materially updating the message.

### Setting app version limits effectively

- `"minVersionCode": 30` → show on builds **30, 31, 32, ...**
- `"maxVersionCode": 35` → show on builds **..., 33, 34, 35**
- Both `"minVersionCode": 30, "maxVersionCode": 35` → show on **30 through 35**, inclusive.
- Omit both → no version-based restriction.
- These filters cannot make an older client understand a newly introduced field or action; they only determine notice eligibility.

### Dates and prioritization

Use ISO-8601 timestamps such as `2026-12-25T00:00:00Z`. The `Z` means **UTC**, not local device time. Convert the intended regional announcement time to UTC before publishing. A future start controls when the client **may show** a notice once it fetches the file; it does not schedule a guaranteed delivery to each phone.

Priority examples: `100` for general feature news, `500` for maintenance, `900` for a download outage, `1000` for migration. These are **suggested conventions**, not special reserved values. If two notices have the same priority, the newest `publishedAt` wins; if still tied, the smallest ID wins. Dismissal may reveal another eligible notice while results have not loaded.

## 4. Ready-to-adapt examples (NOT published)

The following are **hypothetical examples only**. They are *individual announcement objects* that could be inserted into the `announcements` array later, **after** the installed client supports the planned fields. All use `"enabled": false` so they are safe to keep as unpublished drafts. Change this to `true` only when the message is accurate and intended for customers. The current published Sri Lanka object should not be replaced with these examples.

### Example A — New geographic-data downloads temporarily unavailable

Use this to tell customers that **downloading new or updated geographic packs is temporarily unavailable**, while **already-installed offline packs can still be used**. This wording is appropriate only if installed packs really remain usable.

```json
{
  "id": "geographic-downloads-unavailable-2026-10",
  "revision": 1,
  "enabled": false,
  "type": "downtime",
  "priority": 900,
  "repeatPolicy": "every_launch",
  "title": {
    "en": "Geographic data downloads temporarily unavailable"
  },
  "message": {
    "en": "New geographic data downloads and updates are currently unavailable. You can continue using geographic data already installed on your device."
  },
  "action": "offline_data"
}
```

Once downloading works again, disable or remove this notice. **This JSON does not disable downloads or inspect installed packs**; it only communicates the situation.

### Example B — UAE geographic data coming December 25, 2026

Use a future notice for an upcoming release. **December 25, 2026 is an example date, not a verified product launch commitment.** The end date here removes the *coming soon* announcement at the proposed start of launch day; publish a separate *now available* notice if the rollout has actually completed.

```json
{
  "id": "uae-geographic-data-coming-2026-12-25",
  "revision": 1,
  "enabled": false,
  "type": "feature",
  "priority": 100,
  "repeatPolicy": "every_launch",
  "publishedAt": "2026-12-01T00:00:00Z",
  "expiresAt": "2026-12-25T00:00:00Z",
  "title": {
    "en": "UAE geographic data is coming December 25"
  },
  "message": {
    "en": "We are planning to introduce offline geographic data for the United Arab Emirates on December 25, 2026. We'll share an update when it is available."
  },
  "action": "none"
}
```

**Important:** Publishing this message does **not** make UAE data available. UAE support requires separately published, compatible geographic packs and Android client support as appropriate. Do not enable this example before confirming the real plan.

### Example C — Planned maintenance

```json
{
  "id": "planned-data-maintenance-2026-11",
  "revision": 1,
  "enabled": false,
  "type": "maintenance",
  "priority": 500,
  "repeatPolicy": "once_per_revision",
  "publishedAt": "2026-11-10T00:00:00Z",
  "expiresAt": "2026-11-15T00:00:00Z",
  "title": {
    "en": "Planned data-service maintenance"
  },
  "message": {
    "en": "Some geographic-data downloads may be unavailable during scheduled maintenance. Offline data already installed on your device can still be used."
  },
  "action": "offline_data"
}
```

The notice dates define **when to show the announcement**, not the exact maintenance start/end times. Include a maintenance window in the message only when confirmed.

### Example D — New LocalTell feature

```json
{
  "id": "new-feature-announcement-2026",
  "revision": 1,
  "enabled": false,
  "type": "feature",
  "priority": 100,
  "repeatPolicy": "every_launch",
  "title": {
    "en": "A new LocalTell feature is on its way"
  },
  "message": {
    "en": "We're working on an improved experience. We'll announce the feature when it is ready."
  },
  "action": "none"
}
```

### Example E — App migration announcement

```json
{
  "id": "localtell-app-migration-2026",
  "revision": 1,
  "enabled": false,
  "type": "migration",
  "priority": 1000,
  "repeatPolicy": "every_launch",
  "title": {
    "en": "LocalTell app migration notice"
  },
  "message": {
    "en": "We are preparing a new app experience. Please continue using the current LocalTell app until we publish confirmed migration instructions."
  },
  "action": "none"
}
```

Use `action: none` until a safe client-supported migration action exists. **Do not place arbitrary Play Store URLs, intents, or deep links into JSON and assume the app will open them.** An `open_play_store` action would be a future client feature and should only be documented as supported after it is implemented and tested.

## 5. Practical configuration recipes

| Goal | What to change in JSON | Outcome after a supporting client fetches it |
| --- | --- | --- |
| Keep the Sri Lanka message on each fresh launch | Keep `repeatPolicy: every_launch` | Eligible on every *new* launch before results load, even if dismissed in a previous launch |
| Publish a new announcement | Add an object with a new `id`, `enabled: true`, `title.en`, and `message.en` | It becomes eligible according to dates, priority, and version filters |
| Save a message for later | Use `enabled: false` | It will not display |
| Announce a confirmed future date | Set a future `publishedAt`; optionally set `expiresAt` | The announcement is time-filtered locally after being fetched |
| Stop an announcement | Set `enabled: false`, remove it, or let `expiresAt` pass | It no longer qualifies after the app refreshes or locally reaches expiry |
| Reannounce to customers who closed `once_per_revision` | Increase `revision` | New revision becomes eligible; same revision stays dismissed |
| Repeat a notice on future launches | `repeatPolicy: every_launch` | A manual dismissal is not permanent across launches |
| Show only to newer Android builds | Add `minVersionCode` | Builds below the bound skip it |
| Show only to older Android builds | Add `maxVersionCode` | Builds above the bound skip it |
| Make downtime outrank a feature notice | Set higher `priority` on downtime | Downtime is selected first **only while announcements may be shown** |
| Point users to offline pack management | `action: offline_data` | Displays the existing **View Offline Data** button |
| Display without a button | `action: none` | Text-only announcement |
| Show something after results already loaded | **Not supported by design** | The announcement stays hidden; it cannot interrupt results |

### What a remotely published notice cannot do

- It cannot cause actual geographic data downloads to start, fail, pause, or resume.
- It cannot enable new country support by itself.
- It cannot force an already-loaded results screen to show an announcement.
- It cannot send an immediate push notification to all devices.
- It cannot make an older installed APK understand a new repeat policy, category, or app-navigation action.

## 6. Safety and validation checklist

Before activating a notice, confirm:

- `schemaVersion` is **1** and the JSON syntax is valid (no comments or trailing commas).
- Each `id` is unique and follows the permitted pattern.
- `enabled` reflects whether the message is ready to publish.
- The title and message are accurate; required English text is nonblank; optional translations are reviewed.
- All times are valid ISO-8601 instants; `expiresAt` is later than `publishedAt` if both exist.
- Android version-code limits target the intended installed builds, not marketing version names.
- Priority is appropriate relative to other simultaneously active notices.
- `action` is supported by the client that customers actually have installed.
- Planned `type`, `revision`, and `repeatPolicy` values are only relied on once the updated client supports them.
- The notice does not promise data availability, download recovery, or a release date that has not been confirmed.
- The published JSON remains within **64 KiB**, and no location, user, device, SIM, or tracking data is included.

**Final product rule:** Customer announcements are temporary, optional information shown before result data loads. They must never block the app or interrupt a customer who is already viewing locality/location results.
