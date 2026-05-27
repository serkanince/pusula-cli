#!/usr/bin/env bun
/**
 * Pusula CLI - Skyscanner API Wrapper
 * Optimized for Bun - uses native APIs for maximum performance
 */

import { readFileSync } from 'fs';

// ============================================================================
// TYPES
// ============================================================================

export interface SkyscannerConfig {
  market?: string;
  currency?: string;
  locale?: string;
  cookieFile?: string;
  directOnly?: boolean;
  maxStops?: number;
}

export interface SearchParams {
  origin: string;
  destination: string;
  outboundDate: string;
  inboundDate?: string;
  adults?: number;
  cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  maxStops?: number;
}

export interface SearchResults {
  totalResults: number;
  status?: string;
  flights: Flight[];
}

export interface Flight {
  id: string;
  price: {
    amount: number;
    formatted: string;
    currency: string;
  };
  legs: {
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    duration: number;
    stops: number;
    segments: {
      origin: string;
      destination: string;
      departure: string;
      arrival: string;
      carrier: string;
      carrierCode: string;
      flightNumber: string;
      duration: number;
    }[];
  }[];
  deeplink: string | null;
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseDate(dateString: string): { year: string; month: string; day: string } {
  const date = new Date(dateString);
  return {
    year: date.getFullYear().toString(),
    month: (date.getMonth() + 1).toString().padStart(2, '0'),
    day: date.getDate().toString().padStart(2, '0'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN API CLASS
// ============================================================================

export class SkyscannerAPI {
  private baseURL: string;
  private market: string;
  private currency: string;
  private locale: string;
  private cookies: Record<string, string>;
  private travellerContext: string;
  private viewId: string;
  private deviceGuid: string;

  constructor(options: SkyscannerConfig = {}) {
    this.baseURL = 'https://www.skyscanner.com.tr';
    this.market = options.market || 'TR';
    this.currency = options.currency || 'TRY';
    this.locale = options.locale || 'tr-TR';
    this.cookies = this.loadCookies(options.cookieFile || './cookies.txt');
    this.travellerContext = this.cookies['traveller_context'] || generateUUID();
    this.viewId = generateUUID();
    this.deviceGuid = this.cookies['device_guid'] || generateUUID();
    this.maxStops = options.maxStops ?? (options.directOnly ? 0 : 99);
    this.checkCookieExpiry();
  }

  private maxStops: number = 99;
  private cookieExpiry: Record<string, number> = {};  // name → Unix timestamp (0 = no expiry)

  private loadCookies(cookieFile: string): Record<string, string> {
    try {
      const content = readFileSync(cookieFile, 'utf8').trim();
      const cookies: Record<string, string> = {};

      if (!content) return {};

      // Handle JSON format (often exported from Chrome extensions)
      if (content.startsWith('[') || content.startsWith('{')) {
        try {
          const json = JSON.parse(content);
          const cookieArray = Array.isArray(json) ? json : [json];

          cookieArray.forEach((c: any) => {
            if (c.name && c.value) {
              cookies[c.name] = c.value;
              if (c.expirationDate) {
                this.cookieExpiry[c.name] = Math.floor(c.expirationDate);
              }
            }
          });

          process.stderr.write(`\u2705 ${Object.keys(cookies).length} cookies JSON'dan y\u00fcklendi\n`);
          return cookies;
        } catch (e) {
          // If JSON parse fails, maybe it's actually Netscape format even if it looks like JSON
        }
      }

      // Handle Netscape format (tab-separated)
      // Columns: domain, flag, path, secure, expiry(unix), name, value
      content.split('\n').forEach((line: string) => {
        if (line.startsWith('#') || !line.trim()) return;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6];
          const expiry = parseInt(parts[4], 10);
          cookies[name] = value;
          if (!isNaN(expiry) && expiry > 0) {
            this.cookieExpiry[name] = expiry;
          }
        }
      });

      process.stderr.write(`\u2705 ${Object.keys(cookies).length} cookies Netscape format\u0131ndan y\u00fcklendi\n`);
      return cookies;
    } catch (error) {
      process.stderr.write('\u26a0\ufe0f  Cookie dosyas\u0131 bulunamad\u0131 veya okunamad\u0131\n');
      return {};
    }
  }

  private checkCookieExpiry(): void {
    const now = Math.floor(Date.now() / 1000);
    const warnDays = 7;
    const warnSecs = warnDays * 86400;

    const expired: string[] = [];
    const expiringSoon: string[] = [];

    for (const [name, expiry] of Object.entries(this.cookieExpiry)) {
      if (expiry === 0) continue;  // session cookie, no explicit expiry
      if (expiry < now) {
        expired.push(name);
      } else if (expiry - now < warnSecs) {
        const daysLeft = Math.floor((expiry - now) / 86400);
        expiringSoon.push(`${name} (${daysLeft} g\u00fcn)`);
      }
    }

    if (expired.length > 0) {
      process.stderr.write(
        `\n\u274c COOKIE S\u00dcRES\u0130 DOLDU — Scrape i\u015flemleri durabilir!\n` +
        `   S\u00fcresi dolan cookie'ler: ${expired.join(', ')}\n` +
        `   → Skyscanner'dan cookies.txt'i yeniden export edin.\n\n`
      );
    }

    if (expiringSoon.length > 0) {
      process.stderr.write(
        `\u26a0\ufe0f  COOKIE UYARISI — Baz\u0131 cookie'ler yak\u0131nda dolacak:\n` +
        `   ${expiringSoon.join(', ')}\n` +
        `   → Yakl\u0131\u015fan s\u00fcre dolmadan cookies.txt'i yenileyin.\n\n`
      );
    }

    if (expired.length === 0 && expiringSoon.length === 0 && Object.keys(this.cookieExpiry).length > 0) {
      process.stderr.write('\u2705 T\u00fcm cookie\'ler ge\u00e7erli\n');
    }
  }

  private formatCookies(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  private getEntityId(iataCode: string): string {
    const entities: Record<string, string> = {
      HAM: '95673433', AMS: '95565044', FRA: '95673552', LHR: '95565050',
      MUC: '95673626', BER: '95673383', DUS: '95673542', CDG: '95565040',
      MAD: '95565077', FCO: '95673538', BCN: '95565085', VIE: '95673696',
      ZRH: '95673709', JFK: '95565053', LAX: '95673605', ORD: '95565049',
      SFO: '95673685', MIA: '95673615', DXB: '95673544', SIN: '95673686',
      HKG: '95673573', NRT: '95673639', SYD: '95673690',
      ESB: '128668440',
      GYD: '95673513', BEG: '95673488', BRU: '95565036', CPH: '95673519',
      KRK: '95673613', LIS: '95565055', TAS: '95673420', TBS: '95673524',
      TIA: '128669056', BUD: '95673439', WAW: '27547454', DLM : '95673892'
    };

    const entityId = entities[iataCode.toUpperCase()];
    if (!entityId) {
      throw new Error(`Unknown airport: ${iataCode}. Supported: ${Object.keys(entities).join(', ')}`);
    }
    return entityId;
  }

  private async makeRequest(method: string, path: string, body?: any): Promise<any> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'accept-language': `${this.locale},de;q=0.9`,
      'content-type': 'application/json',
      cookie: this.formatCookies(),
      origin: this.baseURL,
      referer: this.baseURL,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'x-skyscanner-channelid': 'website',
      'x-skyscanner-currency': this.currency,
      'x-skyscanner-locale': this.locale,
      'x-skyscanner-market': this.market,
      'x-skyscanner-traveller-context': this.travellerContext,
      'x-skyscanner-viewid': this.viewId,
    };

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(`${this.baseURL}${path}`, options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Search for flights
   * @param params Search parameters
   * @returns Search results with all flights
   */
  async searchFlights(params: SearchParams): Promise<SearchResults> {
    const {
      origin,
      destination,
      outboundDate,
      inboundDate,
      adults = 1,
      cabinClass = 'ECONOMY',
      maxStops = 0
    } = params;

    if (!origin || !destination || !outboundDate) {
      throw new Error('origin, destination, and outboundDate are required');
    }

    process.stderr.write(`\n🔍 Uçuş aranıyor: ${origin} → ${destination}\n`);
    process.stderr.write(`   Gidiş: ${outboundDate}${inboundDate ? `, Dönüş: ${inboundDate}` : ' (tek yön)'}\n`);
    process.stderr.write(`   ${adults} yolcu, ${cabinClass}\n\n`);

    const outbound = parseDate(outboundDate);
    const inbound = inboundDate ? parseDate(inboundDate) : null;

    const requestBody: any = {
      cabinClass: cabinClass.toUpperCase(),
      childAges: [],
      adults,
      preferDirects: maxStops === 0,
      legs: [
        {
          legOrigin: { '@type': 'entity', entityId: this.getEntityId(origin) },
          legDestination: { '@type': 'entity', entityId: this.getEntityId(destination) },
          dates: { '@type': 'date', ...outbound },
        },
      ],
    };

    if (inbound) {
      requestBody.legs.push({
        legOrigin: { '@type': 'entity', entityId: this.getEntityId(destination) },
        legDestination: { '@type': 'entity', entityId: this.getEntityId(origin) },
        dates: { '@type': 'date', ...inbound },
      });
    }

    this.maxStops = maxStops;
    process.stderr.write('📡 İstek gönderiliyor...\n');
    const searchResponse = await this.makeRequest('POST', '/g/radar/api/v2/web-unified-search/', requestBody);

    const sessionId = searchResponse.context?.sessionId;
    if (!sessionId) {
      throw new Error('No session ID received');
    }

    process.stderr.write(`✅ Session: ${sessionId.substring(0, 30)}...\n\n`);

    // İlk POST yanıtı zaten complete ise direkt parse et — poll'a gerek yok
    const initStatus = searchResponse.itineraries?.context?.status;
    const initResults = searchResponse.itineraries?.results || [];
    if (initStatus === 'complete' && initResults.length > 0) {
      process.stderr.write(`⚡ İlk yanıtta sonuçlar hazır (${initResults.length} uçuş) — poll atlanıyor\n\n`);
      return this.parseResults(searchResponse);
    }

    return await this.pollResults(sessionId, searchResponse);
  }

  private async pollResults(sessionId: string, initialResponse?: any): Promise<SearchResults> {
    process.stderr.write('⏳ Sonuçlar bekleniyor...\n\n');

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      // İlk iterasyonda beklemeden önce initial response'ı kontrol et
      const response = attempts === 0 && initialResponse
        ? initialResponse
        : await this.makeRequest('GET', `/g/radar/api/v2/web-unified-search/${sessionId}`);

      const status = response.context?.status;
      const itinStatus = response.itineraries?.context?.status;
      const results = response.itineraries?.results || [];

      if (attempts > 0) {
        process.stderr.write(`   Poll #${attempts}: ${status} - ${results.length} uçuş\n`);
      }

      // complete veya complete_not_modified → bitti
      if (status === 'complete' || itinStatus === 'complete' || itinStatus === 'complete_not_modified') {
        if (results.length > 0) {
          process.stderr.write('\n✅ Tüm sonuçlar hazır!\n\n');
          return this.parseResults(response);
        } else if (attempts > 0) {
          // Poll tamamlandı ama sonuç yok — bir kez daha bekleyip dene
          if (attempts < 3) {
            await sleep(3000);
            attempts++;
            continue;
          }
          process.stderr.write('\n✅ Tüm sonuçlar hazır!\n\n');
          return this.parseResults(response);
        }
      }

      await sleep(2000);
      attempts++;
    }

    process.stderr.write('\n⚠️  Zaman aşımı, kısmi sonuçlar döndürülüyor\n\n');
    const finalResponse = await this.makeRequest('GET', `/g/radar/api/v2/web-unified-search/${sessionId}`);
    return this.parseResults(finalResponse);
  }

  private parseResults(apiResponse: any): SearchResults {
    const results = apiResponse.itineraries?.results || [];

    const flights: Flight[] = results
      .map((item: any) => {
        if (!item) return null;

        return {
          id: item.id,
          price: {
            amount: parseFloat(String(item.price?.raw || 0)),
            formatted: item.price?.formatted || 'N/A',
            currency: this.currency,
          },
          legs: (item.legs || []).map((leg: any) => ({
            origin: leg.origin?.displayCode || 'Unknown',
            destination: leg.destination?.displayCode || 'Unknown',
            departure: leg.departure || '',
            arrival: leg.arrival || '',
            duration: leg.durationInMinutes || 0,
            stops: leg.stopCount || 0,
            segments: (leg.segments || []).map((seg: any) => ({
              origin: seg.origin?.displayCode || 'Unknown',
              destination: seg.destination?.displayCode || 'Unknown',
              departure: seg.departure || '',
              arrival: seg.arrival || '',
              carrier: seg.marketingCarrier?.name || 'Unknown',
              carrierCode: seg.marketingCarrier?.alternateId || '',
              flightNumber: seg.flightNumber || '',
              duration: seg.durationInMinutes || 0,
            })),
          })),
          deeplink: item.deeplink?.url || null,
        };
      })
      .filter((flight: Flight | null): flight is Flight => flight !== null)
      .filter((flight: Flight) => flight.legs.every((leg: any) => leg.stops <= this.maxStops));

    return {
      totalResults: flights.length,
      status: apiResponse.context?.status,
      flights: flights.sort((a, b) => a.price.amount - b.price.amount),
    };
  }
}

// ============================================================================
// CLI ENTRYPOINT
// ============================================================================

if (import.meta.main) {
  // Args: origin destination outboundDate [inboundDate] [adults] [maxStops]
  // Example: bun run pusula.ts ESB BCN 2026-04-10 - 1 0
  const args = process.argv.slice(2);

  const origin = args[0] || 'ESB';
  const destination = args[1] || 'BCN';
  const outboundDate = args[2] || '2026-04-10';
  const inboundDate = args[3] && args[3] !== '-' ? args[3] : undefined;
  const adults = args[4] ? parseInt(args[4], 10) : 1;
  const maxStops = args[5] !== undefined ? parseInt(args[5], 10) : 0;

  process.stderr.write(`\n🔍 ${origin} → ${destination} | ${outboundDate}${inboundDate ? ' ↔ ' + inboundDate : ' (tek yön)'} | ${adults} yolcu | max ${maxStops} durak\n`);

  const api = new SkyscannerAPI({ maxStops });

  try {
    const results = await api.searchFlights({
      origin,
      destination,
      outboundDate,
      inboundDate,
      adults,
      maxStops,
    });

    // Sadece sonuç JSON'u stdout'a yaz — Python subprocess bunu parse eder
    process.stdout.write(JSON.stringify(results) + '\n');
  } catch (err: any) {
    process.stderr.write(`\n❌ Hata: ${err.message}\n`);
    process.stdout.write(JSON.stringify({ totalResults: 0, flights: [], error: err.message }) + '\n');
    process.exit(1);
  }
}
