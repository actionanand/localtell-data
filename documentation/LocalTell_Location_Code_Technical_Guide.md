# LocalTell Location Codes

**Technical explanation of the worldwide 19-digit and 15-character formats**  
**AR Apps | LocalTell | Reference version 1.0 | 17 October 2026**

> **Implementation basis:** This guide describes `LocalTellLocationCode.kt` and `LocalTellLocationCodeTest.kt` on the tested `feature/2-Ui-improvement` branch. It is a description of the **V1 codec**, not a proposed replacement or a claim that the unfinished Saved Places branch has already shipped.

## 1. Executive summary

LocalTell converts a latitude/longitude pair into **two equivalent, reversible location codes**, entirely on the device:

- **Numeric code:** 19 digits = 18-digit payload + **1 Verhoeff check digit**. Spaces are just for readability.
- **Short code:** 15 characters = 13 Base-31 payload characters + **2 CRC-8/ATM check characters**. Hyphens are just for readability.
- **Both formats identify the same canonical coordinate**, rounded to six decimal places.
- **Worldwide operation:** coordinates in the latitude range -90° to +90° and longitude range -180° to +180° are supported. No India-only condition, mobile signal, internet connection, or offline country pack is needed to create or decode codes.
- **What a code does not contain:** a locality name, street address, altitude, GPS accuracy, user identity, or proof that the actual device was at the represented coordinate.

### Example: Bengaluru, India

| Field | Value |
|---|---|
| Input latitude | `12.971598` |
| Input longitude | `77.594566` |
| 19-digit numeric code | `0 370 697 756 405 661 642` |
| 15-character short code | `23G93-PU3ER-X2S3P` |
| After decoding either | Latitude `12.971598`, longitude `77.594566` |

These values are **golden test vectors**, meaning existing releases should preserve them across refactoring.

## 2. Design goals

1. Encode a geographic coordinate without relying on an external mapping or geocoding service.
2. Make the numeric form easy to dictate or enter on a phone.
3. Provide a shorter, human-friendly alternative with ambiguous characters excluded.
4. Detect common typing errors before treating the text as coordinates.
5. Include a version namespace so future formats can be distinguished rather than misread.
6. Keep old V1 codes stable and compatible across app upgrades and countries.

## 3. Step-by-step encoding pipeline

The two representations share the same internal 64-bit integer payload.

**Latitude / longitude → six-decimal coordinate grid → location key → versioned payload → numeric or short encoding → checksum → displayed code.**

### Step A — Validate coordinates

Reject values that are not finite (`NaN`, positive or negative infinity), latitude outside `[-90, +90]`, or longitude outside `[-180, +180]`. Endpoints are supported. Encoding invalid coordinates raises an error rather than fabricating a valid-looking code.

### Step B — Round coordinates to a one-millionth-degree grid

The code uses a scale factor of **1,000,000** for both axes, with offsets that turn negative values into nonnegative grid indexes:

```text
latIndex = round((latitude  +  90) × 1,000,000)
lonIndex = round((longitude + 180) × 1,000,000)
```

Allowed index ranges:

- `latIndex`: 0 through 180,000,000 inclusive.
- `lonIndex`: 0 through 360,000,000 inclusive.

Thus there are `360,000,001` possible longitude grid positions per latitude row, and `180,000,001` latitude rows. Rounding, not truncation, produces the canonical values. The result is recoverable to six decimal places, not to arbitrary original floating-point precision.

### Step C — Pack the two indexes into one location key

The row-major formula is:

```text
LON_BUCKETS = 360,000,001
locationKey = latIndex × LON_BUCKETS + lonIndex
LOCATION_SPACE = 180,000,001 × 360,000,001
               = 64,800,000,540,000,001
```

This mapping is **one-to-one for the canonical coordinate grid**. Every allowed `(latIndex, lonIndex)` pair has a distinct location key. The key is a nonnegative integer, not a hash; there is no geographic collision caused by the packing itself.

### Step D — Include the codec version

For V1:

```text
VERSION = 1
payload = (VERSION - 1) × LOCATION_SPACE + locationKey
        = locationKey                 (for V1 only)
```

The implementation reserves version numbers 1 through 15 but currently **accepts only V1 on decoding**. A valid check digit does not make an unsupported future version acceptable. This distinction prevents a newer format from silently producing an incorrect V1 position.

### Worked calculation for Bengaluru

```text
latitude  = 12.971598     longitude = 77.594566
latIndex  = 102,971,598   lonIndex  = 257,594,566
locationKey = 102,971,598 × 360,000,001 + 257,594,566
            = 37,069,775,640,566,164
V1 payload  = 37,069,775,640,566,164
```

Both human-readable formats below are derived from **this same integer**.

## 4. The 19-digit numeric representation

### Constructing the numeric code

1. Convert the payload integer into decimal text.
2. **Left-pad with zeros to exactly 18 digits**. Leading zeros are significant: never parse the entire displayed 19-digit code into an integer that drops them before validation.
3. Calculate **one Verhoeff check digit** from those 18 digits.
4. Append the check digit, producing exactly **19 digits**.
5. Group from the right in threes, separated by spaces, for readability.

For Bengaluru:

```text
18-digit payload: 037069775640566164
Verhoeff digit:   2
Raw 19 digits:    0370697756405661642
Displayed:        0 370 697 756 405 661 642
```

### What is the Verhoeff algorithm?

Verhoeff is a decimal error-detection algorithm based on three predefined mathematical tables: a digit-composition table, a permutation table and an inverse table. The code traverses the payload digits in a defined order and calculates a final decimal digit. Decoding reruns the check over **all 19 digits**; only a zero check state is accepted.

Its principal benefit is detection of **all single-decimal-digit substitution errors** and **all transpositions of unequal adjacent decimal digits**. It is **not encryption, not a digital signature, and not a guarantee against deliberate manipulation or every possible multi-digit typo**.

### Numeric decoding

Normalize accepted presentation separators (spaces and hyphens), verify length = 19, validate decimal digits and Verhoeff, parse the first 18 digits, then decode the shared versioned payload. The app returns a specific error rather than an invented coordinate on a failed check.

## 5. The 15-character short representation

### Safe Base-31 alphabet

The alphabet in V1 is exactly:

```text
23456789ABCDEFGHJKMNPQRSTUVWXYZ
```

It contains **31 symbols**. The characters `0`, `1`, `I`, `L` and `O` are excluded to reduce visual confusion. The result is case-insensitive when read, because decoding normalizes to uppercase.

### Constructing the short code

1. Convert the **same versioned payload** to base 31 using the safe alphabet.
2. Left-pad the representation to **13 characters** using the alphabet's first symbol, `2`.
3. Compute **CRC-8/ATM** on the payload represented as an **8-byte, big-endian signed-long byte array**.
4. Express the 8-bit CRC value as **two Base-31 symbols**, with `alphabet[crc / 31]` followed by `alphabet[crc % 31]`.
5. Append those two symbols to make **15 characters**; display in **three groups of five**.

For Bengaluru: `23G93-PU3ER-X2S3P`.

### What is CRC-8/ATM?

A CRC (cyclic redundancy check) is an algorithm for detecting accidental changes in data. This implementation uses:

| Setting | V1 value |
|---|---|
| CRC width | 8 bits |
| Polynomial | `0x07` |
| Initial value | `0x00` |
| Reflected input/output | No / No |
| Final XOR | `0x00` |
| Data checked | Eight big-endian bytes of the numeric payload |
| Displayed CRC | Two characters from the safe Base-31 alphabet |

An 8-bit checksum has only 256 possible states: some errors can pass, and an adversary could intentionally forge a valid checksum. The short check characters improve **typo detection**, not security or authenticity. The Base-31 format is not encryption and not a compressed address database.

### Short-code decoding

Normalize case, whitespace and hyphens; require exactly 15 valid alphabet characters; convert the first 13 Base-31 symbols back to the shared integer; recompute the CRC from that integer; compare the final two symbols; then decode the versioned coordinate. **A short code consisting entirely of digits can be valid**, because digits `2`–`9` belong to the alphabet; decode by the requested format, not by a guess that letters must appear.

## 6. Decoding the common payload

After either representation has passed its checksum:

```text
version     = floor(payload / LOCATION_SPACE) + 1
locationKey = payload mod LOCATION_SPACE
latIndex    = floor(locationKey / 360,000,001)
lonIndex    = locationKey mod 360,000,001
latitude    = (latIndex - 90,000,000) / 1,000,000
longitude   = (lonIndex - 180,000,000) / 1,000,000
```

The result represents the **canonical six-decimal coordinate**. A valid payload whose version is not V1 is rejected as `UnsupportedVersion`.

## 7. Precision, GPS accuracy and privacy

- **Grid resolution:** 0.000001 degree. In latitude this is approximately **11 cm per grid step**; longitudinal distance per step depends on latitude (about 11 cm at the equator, approaching zero near the poles).
- **Quantization uncertainty:** relative to a valid source coordinate, rounding introduces at most roughly half a grid step on each axis (approximately 5.6 cm north/south; and at most about 5.6 cm east/west near the equator). This is a representation property, **not a promise of device accuracy**.
- **GNSS/GPS accuracy:** a phone may report uncertainty of several metres or more. The code cannot correct that uncertainty. A highly detailed code can still describe an inaccurate GPS reading.
- **Public sharing:** anyone who receives a valid code can recover the coordinate. Treat codes as **sensitive location data**, especially for home or workplace locations; the checksum provides no secrecy.
- **Offline geographic packs:** these may supply a locality label, but **never control whether codes can be generated or decoded worldwide**.

## 8. Tested vectors and edge cases

The repository's V1 unit tests include the following exact vectors:

| Latitude, longitude | Numeric code | Short code |
|---|---|---|
| `0.000000, 0.000000` | `0 324 000 002 700 000 002` | `23AJF-FP6E3-7U43J` |
| `12.971598, 77.594566` | `0 370 697 756 405 661 642` | `23G93-PU3ER-X2S3P` |
| `8.088306, 77.538451` | `0 353 117 905 156 267 573` | `23E4K-GDYHA-PR872` |
| `-33.868820, 151.209296` | `0 202 072 251 873 404 765` | `22TPA-NB237-H7P3J` |
| `90.000000, 180.000000` | `0 648 000 005 400 000 001` | `24K3V-WBAT4-DN653` |
| `-90.000000, -180.000000` | `0 000 000 000 000 000 009` | `22222-22222-22222` |

Unit tests also verify random global coordinate round trips, case and separator normalization, invalid checksums, ambiguous short characters, out-of-range inputs and rejection of a checksum-valid unsupported version. Tests establish regression coverage; they are not proof of the absence of every possible implementation defect.

## 9. Practical decoding failures

| Result | Meaning / recommended behavior |
|---|---|
| `InvalidLength` | Wrong number of symbols after removing separators; ask for correction. |
| `MalformedNumericCode` | The numeric input cannot be parsed as the defined decimal code. |
| `InvalidCharacter` | The short code contains an excluded character such as `O` or `I`. |
| `InvalidChecksum` | The input fails Verhoeff or CRC validation; do not navigate to it. |
| `UnsupportedVersion` | Valid-looking payload is not a V1 code; do not silently decode as V1. |
| `OutOfRange` | Decoded payload is outside the allowed numeric domain. |
| `MalformedShortCode` | The Base-31 payload cannot be decoded safely. |

## 10. Compatibility contract for future developers

**Do not change** the scale, offsets, longitude bucket count, numeric leading-zero behavior, safe alphabet ordering, Verhoeff tables/order, CRC parameters or byte order without assigning a **new code version** and migration/compatibility plan. Keep all golden vectors unchanged. Preserve the worldwide codec even when location labels or offline packs are country-specific. Retest both formats against the same coordinate after every significant refactor.

## Sources and implementation references

1. **LocalTell codec implementation (V1):** https://github.com/actionanand/local-tell/blob/feature/2-Ui-improvement/app/src/main/java/com/actionanand/localtell/app/locationcode/LocalTellLocationCode.kt
2. **LocalTell V1 regression tests and golden vectors:** https://github.com/actionanand/local-tell/blob/feature/2-Ui-improvement/app/src/test/java/com/actionanand/localtell/app/locationcode/LocalTellLocationCodeTest.kt

*Document status: technical explanation grounded in the above source snapshot. Recheck it when the implementation changes; do not treat this document as an authorization to change the existing codec.*
