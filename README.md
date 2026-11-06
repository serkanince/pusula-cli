# 🧭 Pusula CLI

<div align="center">
  <img src="logo.png" width="512">
</div>

High-performance Skyscanner API wrapper for Bun. Optimized with stealth-mode polling and strict flight filtering for terminal enthusiasts.

## 📦 NPM Package

- NPM: [https://www.npmjs.com/package/pusula-cli](https://www.npmjs.com/package/pusula-cli)

## ⚡ Quick Install

```bash
# Global install
npm install -g pusula-cli

# Run without installing globally
npx pusula ESB BCN 2026-04-10 - 1 0
```



## 🚀 Setup

```bash
# 1. Install dependencies
bun install

# 2. Export cookies from Skyscanner
# Visit https://www.skyscanner.com.tr in Chrome
# Option A: Install "Get cookies.txt LOCALLY" extension (Netscape format)
# Option B: Install "EditThisCookie" (JSON format) - Recommended
# Save as cookies.txt

# 3. Run directly
bun run pusula.ts
```

## 💻 Usage

```typescript
import { SkyscannerAPI } from './pusula';

const api = new SkyscannerAPI({
  market: 'TR',
  currency: 'TRY',
  locale: 'tr-TR',
});

// Search with specific stops
const results = await api.searchFlights({
  origin: 'ESB',
  destination: 'BCN',
  outboundDate: '2026-03-26',
  maxStops: 1, // 0 for direct, 1 for max 1 stop, etc.
  adults: 1,
});

console.log(`Found ${results.totalResults} flights`);
```

## 📖 API Reference

### Constructor

```typescript
new SkyscannerAPI({
  market?: string;      // Default: 'TR'
  currency?: string;    // Default: 'TRY'
  locale?: string;      // Default: 'tr-TR'
  cookieFile?: string;  // Default: './cookies.txt'
})
```

### searchFlights(params)

```typescript
{
  origin: string;           // IATA code (e.g., 'ESB')
  destination: string;      // IATA code (e.g., 'BCN')
  outboundDate: string;     // YYYY-MM-DD
  inboundDate?: string;     // Optional - omit for one-way
  adults?: number;          // Default: 1
  cabinClass?: string;      // 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
  maxStops?: number;        // Default: 0 (Strict filter)
}
```

## 🌍 Supported Airports (Entity IDs)

Skyscanner uses a custom **Entity ID** system. The wrapper includes a rich mapping of popular airports in [airports.json](file:///Users/serkan/Repo/pusula-cli/airports.json) (90+ airports including Turkish hubs, Europe, America, Asia).

| IATA | Airport Name | Entity ID |
|------|--------------|-----------|
| **IST** | İstanbul | `95673323` |
| **SAW** | Sabiha Gökçen | `95673324` |
| **ESB** | Ankara | `128668440` |
| **ADB** | İzmir | `95673399` |
| **AYT** | Antalya | `95673612` |
| **BCN** | Barcelona | `95565085` |
| **LHR** | Londra Heathrow | `95565050` |
| ... | ... | ... |

### 🚀 Dynamic Autosuggest Fallback
If an airport is not in [airports.json](file:///Users/serkan/Repo/pusula-cli/airports.json) or the database:
1. `pusula.ts` automatically queries Skyscanner's internal Autosuggest API on-the-fly (`/g/autosuggest-flights/v1.0/{locale}/{IATA}/`).
2. Extracts the exact `GeoId`.
3. Auto-appends the new airport to [airports.json](file:///Users/serkan/Repo/pusula-cli/airports.json) so subsequent queries are instant.

You can also look up or pre-populate any airport directly from the CLI:
```bash
bun run pusula.ts --lookup TZX
```

## 🔍 How It Works (Human-Like Mode)

1. **Auto-Format Detection**: Automatically detects if `cookies.txt` is in **JSON** or **Netscape** format.
2. **Mandatory Delay**: Implements a random **30-40 second delay** *before* the first poll and between checks. This is critical for staying under the radar.
3. **Strict Filtering**: The Skyscanner API treats filters as "preferences". This wrapper implements a **strict manual filter** for `maxStops` to ensure you only get exactly what you asked for.

## ✨ Features

- ✅ **Smart Cookie Loader** - Supports JSON & Netscape exports
- ✅ **Anti-Bot Polling** - Forced human-like random delays
- ✅ **Strict Stop Filter** - Filter by direct, 1-stop, or 2-stop flights
- ✅ **Turkey Optimized** - Defaulted to TR market and TRY currency
- ✅ **TypeScript Native** - Type definitions for all requests/responses

### 🛣️ Planned

- 🚧 **Automatic Cookie Setup** - Auto-detect and apply required Skyscanner cookies.
- 🤝 **Contributions Welcome** - PRs and ideas are greatly appreciated.

## ⚠️ Important

- **Entity IDs**: Finding the correct `entityId` is more reliable than using just IATA codes for some routes.
- **Cookies**: If searches stop returning results, re-export your cookies.
- **Rate limiting**: The 30s delay is mandatory to avoid permanent IP bans.

**Built with Bun + TypeScript • Zero Dependencies**

## Disclaimer

This project is provided strictly for educational and research purposes.
It is an independent, unofficial tool and is not affiliated with, endorsed by, or sponsored by Skyscanner.
Use it responsibly and ensure your usage complies with all applicable laws, platform terms of service, and rate-limit policies.
The authors and contributors assume no liability for misuse or for any service disruptions, account restrictions, or other consequences resulting from its use.
