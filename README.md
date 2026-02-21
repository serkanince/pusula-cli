# 🧭 Pusula CLI

<div align="center">
  <img src="logo.png" width="512">
</div>

High-performance Skyscanner API wrapper for Bun. Optimized with stealth-mode polling and strict flight filtering for terminal enthusiasts.



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

Skyscanner uses a custom **Entity ID** system. The wrapper includes a mapping for common airports. 

| IATA | Airport Name | Entity ID |
|------|--------------|-----------|
| **ESB** | Ankara | `128668440` |
| **BCN** | Barcelona | `95565085` |
| HAM | Hamburg | `95673433` |
| AMS | Amsterdam | `95565044` |
| ... | ... | ... |

*To add more: Search for the flight on the website and check the `web-unified-search` request body to find the exact `entityId`.*

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

## ⚠️ Important

- **Entity IDs**: Finding the correct `entityId` is more reliable than using just IATA codes for some routes.
- **Cookies**: If searches stop returning results, re-export your cookies.
- **Rate limiting**: The 30s delay is mandatory to avoid permanent IP bans.

**Built with Bun + TypeScript • Zero Dependencies**
