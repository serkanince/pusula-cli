#!/usr/bin/env bun
/**
 * Pusula CLI - Skyscanner API Wrapper
 * Optimized for Bun - uses native APIs for maximum performance
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { Database } from 'bun:sqlite';

// ============================================================================
// TYPES
// ============================================================================

export interface AirportInfo {
  entityId: string;
  name?: string;
  city?: string;
  country?: string;
}

export interface SkyscannerConfig {
  market?: string;
  currency?: string;
  locale?: string;
  cookieFile?: string;
  cookies?: Record<string, string> | string;
  userAgent?: string;
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

// Tek bir HTTP isteğinin zaman aşımı — yanıt vermeyen bağlantı subprocess'i kilitlemesin.
const REQUEST_TIMEOUT_MS = 15_000;
// Poll döngüsünün toplam süre sınırı (deneme sayısından bağımsız). Python subprocess
// timeout'u (120 sn) en kötü durumdan (15 + 60 + 18 + 15 ≈ 108 sn) büyük kalmalı.
const POLL_DEADLINE_MS = 60_000;

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
  private userAgent: string;

  constructor(options: SkyscannerConfig = {}) {
    this.baseURL = 'https://www.skyscanner.com.tr';
    this.market = options.market || 'TR';
    this.currency = options.currency || 'TRY';
    this.locale = options.locale || 'tr-TR';

    // Cookie ve User-Agent hiyerarşik çözümleme (options > env > akıllı dosya keşfi)
    const resolvedCookiePath = this.resolveCookiePath(options.cookieFile);
    this.cookieFilePath = resolvedCookiePath;
    this.cookies = this.loadCookies(options.cookies, resolvedCookiePath);
    this.userAgent = this.loadUserAgent(options.userAgent, resolvedCookiePath);

    this.travellerContext = this.cookies['traveller_context'] || generateUUID();
    this.viewId = generateUUID();
    this.deviceGuid = this.cookies['device_guid'] || generateUUID();
    this.maxStops = options.maxStops ?? (options.directOnly ? 0 : 1);
    this.checkCookieExpiry();
    this.loadAirports();
  }

  private maxStops: number = 99;
  private cookieExpiry: Record<string, number> = {};  // name → Unix timestamp (0 = no expiry)
  public staticAirports: Record<string, string | AirportInfo> = {};
  private entityCache: Map<string, string> = new Map();
  private airportsFilePath: string | null = null;
  public cookieFilePath: string | null = null;

  /**
   * Çerez dosyasının konumunu çalışma dizinine bağımlı kalmadan otomatik keşfeder.
   */
  private resolveCookiePath(explicitPath?: string): string | null {
    if (explicitPath && existsSync(explicitPath)) {
      return explicitPath;
    }

    const envPath = process.env.PUSULA_COOKIE_FILE || process.env.SKYSCANNER_COOKIE_FILE;
    if (envPath && existsSync(envPath)) {
      return envPath;
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const candidatePaths = [
      // 1. Script dosyasının kendi dizini (pusula-cli/cookies.txt)
      join(import.meta.dir, 'cookies.txt'),
      // 2. Mevcut çalışma dizini (CWD/cookies.txt)
      join(process.cwd(), 'cookies.txt'),
      // 3. Üst uygulama / scraper dizinleri
      join(import.meta.dir, '../../scraper/pusula-cli/cookies.txt'),
      join(process.cwd(), 'scraper/pusula-cli/cookies.txt'),
      // 4. Global kullanıcı dizinleri
      homeDir ? join(homeDir, '.pusula', 'cookies.txt') : '',
    ].filter(Boolean);

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        return p;
      }
    }
    return explicitPath || null;
  }

  /**
   * User-Agent çözümleme: options > env > user-agent.txt > varsayılan Chrome UA
   */
  private loadUserAgent(explicitUA?: string, cookieFilePath?: string | null): string {
    const defaultUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    if (explicitUA && explicitUA.trim()) {
      return explicitUA.trim();
    }

    const envUA = process.env.PUSULA_USER_AGENT || process.env.SKYSCANNER_USER_AGENT;
    if (envUA && envUA.trim()) {
      return envUA.trim();
    }

    const candidateUAFiles = [
      cookieFilePath ? join(dirname(cookieFilePath), 'user-agent.txt') : '',
      join(import.meta.dir, 'user-agent.txt'),
      join(process.cwd(), 'user-agent.txt'),
      join(import.meta.dir, '../../scraper/pusula-cli/user-agent.txt'),
    ].filter(Boolean);

    for (const uaFile of candidateUAFiles) {
      if (existsSync(uaFile)) {
        try {
          const ua = readFileSync(uaFile, 'utf8').trim();
          if (ua) return ua;
        } catch {
          // ignore
        }
      }
    }
    return defaultUA;
  }

  /**
   * Çerezleri yükler (options nesnesi > env string > dosya)
   */
  private loadCookies(cookiesOption?: Record<string, string> | string, filePath?: string | null): Record<string, string> {
    // 1. Doğrudan options.cookies olarak Record nesnesi verilmişse
    if (cookiesOption && typeof cookiesOption === 'object' && !Array.isArray(cookiesOption)) {
      process.stderr.write(`✅ ${Object.keys(cookiesOption).length} cookies doğrudan options nesnesinden yüklendi\n`);
      return { ...cookiesOption };
    }

    // 2. Doğrudan options.cookies olarak string (JSON, Netscape veya Cookie header) verilmişse
    if (typeof cookiesOption === 'string' && cookiesOption.trim()) {
      const parsed = this.parseCookieString(cookiesOption.trim(), 'options.cookies');
      if (Object.keys(parsed).length > 0) return parsed;
    }

    // 3. Ortam değişkeninden oku (PUSULA_COOKIES veya SKYSCANNER_COOKIES)
    const envCookies = process.env.PUSULA_COOKIES || process.env.SKYSCANNER_COOKIES;
    if (envCookies && envCookies.trim()) {
      const parsed = this.parseCookieString(envCookies.trim(), 'ortam değişkeni (PUSULA_COOKIES)');
      if (Object.keys(parsed).length > 0) return parsed;
    }

    // 4. Çözümlenmiş dosya yolundan oku
    if (filePath && existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8').trim();
        if (content) {
          const parsed = this.parseCookieString(content, filePath);
          return parsed;
        }
      } catch (err: any) {
        process.stderr.write(`⚠️  Cookie dosyası okunamadı (${filePath}): ${err.message}\n`);
      }
    }

    process.stderr.write('⚠️  Geçerli bir cookie kaynağı bulunamadı (options, env veya cookies.txt)\n');
    return {};
  }

  /**
   * JSON, Netscape veya HTTP 'Cookie: key=val;' formatlarını akıllıca parse eder.
   */
  private parseCookieString(content: string, sourceLabel: string): Record<string, string> {
    const cookies: Record<string, string> = {};

    // A. JSON formatı ([{ name, value, expirationDate }] veya { name: value })
    if (content.startsWith('[') || content.startsWith('{')) {
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json)) {
          json.forEach((c: any) => {
            if (c.name && c.value) {
              cookies[c.name] = c.value;
              if (c.expirationDate) {
                this.cookieExpiry[c.name] = Math.floor(c.expirationDate);
              }
            }
          });
        } else if (typeof json === 'object' && json !== null) {
          Object.entries(json).forEach(([k, v]) => {
            if (typeof v === 'string') cookies[k] = v;
            else if (v && typeof v === 'object' && (v as any).value) cookies[k] = (v as any).value;
          });
        }
        if (Object.keys(cookies).length > 0) {
          process.stderr.write(`✅ ${Object.keys(cookies).length} cookies JSON formatında ${sourceLabel} üzerinden yüklendi\n`);
          return cookies;
        }
      } catch {
        // Parse hatası olursa Netscape denemesine devam et
      }
    }

    // B. Netscape formatı (tab-separated)
    if (content.includes('\t')) {
      content.split('\n').forEach((line: string) => {
        if (line.startsWith('#') || !line.trim()) return;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6]?.trim();
          const expiry = parseInt(parts[4], 10);
          if (name && value) {
            cookies[name] = value;
            if (!isNaN(expiry) && expiry > 0) {
              this.cookieExpiry[name] = expiry;
            }
          }
        }
      });
      if (Object.keys(cookies).length > 0) {
        process.stderr.write(`✅ ${Object.keys(cookies).length} cookies Netscape formatında ${sourceLabel} üzerinden yüklendi\n`);
        return cookies;
      }
    }

    // C. Standart HTTP Cookie başlığı formatı (name1=val1; name2=val2)
    if (content.includes('=')) {
      content.split(';').forEach((pair: string) => {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const name = pair.substring(0, idx).trim();
          const value = pair.substring(idx + 1).trim();
          if (name && value) {
            cookies[name] = value;
          }
        }
      });
      if (Object.keys(cookies).length > 0) {
        process.stderr.write(`✅ ${Object.keys(cookies).length} cookies Header formatında ${sourceLabel} üzerinden yüklendi\n`);
        return cookies;
      }
    }

    return cookies;
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

  private loadAirports(): void {
    const candidatePaths = [
      join(import.meta.dir, 'airports.json'),
      join(process.cwd(), 'airports.json'),
      join(import.meta.dir, '../../server/airports.json'),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, 'utf8');
          this.staticAirports = JSON.parse(content);
          this.airportsFilePath = p;
          process.stderr.write(`✅ ${Object.keys(this.staticAirports).length} havalimanı airports.json dosyasından yüklendi\n`);
          return;
        } catch {
          // ignore error
        }
      }
    }
  }

  private persistAirport(code: string, info: AirportInfo): void {
    try {
      this.staticAirports[code] = info;
      const targetPath = this.airportsFilePath || join(import.meta.dir, 'airports.json');
      writeFileSync(targetPath, JSON.stringify(this.staticAirports, null, 2) + '\n', 'utf8');
    } catch {
      // ignore write errors
    }
  }

  public async fetchEntityFromAutosuggest(iataCode: string): Promise<AirportInfo | null> {
    const code = iataCode.trim().toUpperCase();
    try {
      const path = `/g/autosuggest-flights/v1.0/${this.locale}/${encodeURIComponent(code)}/`;
      const data = await this.makeRequest('GET', path);
      if (Array.isArray(data) && data.length > 0) {
        // Öncelik: PlaceId tam eşleşen veya GeoId/GeoContainerId içeren sonuç
        const exact = data.find((d: any) => String(d.PlaceId || '').toUpperCase() === code);
        const match = exact || data.find((d: any) => d.GeoId || d.GeoContainerId) || data[0];
        const rawId = match?.GeoId || match?.GeoContainerId;
        if (rawId) {
          const info: AirportInfo = {
            entityId: String(rawId),
            name: match.PlaceName || match.PlaceNameEn || code,
            city: match.CityName || '',
            country: match.CountryName || '',
          };
          this.entityCache.set(code, info.entityId);
          this.persistAirport(code, info);
          return info;
        }
      }
    } catch (err: any) {
      process.stderr.write(`⚠️  [${code}] Autosuggest sorgusu başarısız: ${err.message}\n`);
    }
    return null;
  }

  public async getEntityId(iataCode: string): Promise<string> {
    const code = iataCode.trim().toUpperCase();

    // 1. Doğrudan Skyscanner entityId verilmişse (tamamen sayısal)
    if (/^\d+$/.test(code)) {
      return code;
    }

    // 2. Bellek önbelleğinde varsa
    if (this.entityCache.has(code)) {
      return this.entityCache.get(code)!;
    }

    // 3. Statik airports.json dosyasından kontrol et
    const staticEntry = this.staticAirports[code];
    if (staticEntry) {
      const id = typeof staticEntry === 'string' ? staticEntry : staticEntry.entityId;
      if (id) {
        this.entityCache.set(code, String(id));
        return String(id);
      }
    }

    // 4. Harici SQLite veritabanından sorgula (destinations/supported_destinations)
    try {
      const dbPaths = [
        process.env.PUSULA_DB_PATH,
        process.env.DB_PATH,
      ].filter(Boolean) as string[];

      for (const dbPath of dbPaths) {
        if (existsSync(dbPath)) {
          const db = new Database(dbPath, { readonly: true });
          try {
            const row = db.query<{ entity_id: string }, [string]>(
              'SELECT entity_id FROM supported_destinations WHERE UPPER(code) = ? AND entity_id IS NOT NULL'
            ).get(code);
            if (row && row.entity_id) {
              const id = String(row.entity_id);
              this.entityCache.set(code, id);
              return id;
            }
          } finally {
            db.close();
          }
          break;
        }
      }
    } catch {
      // DB okunamazsa devam et
    }

    // 5. Dinamik Autosuggest Fallback: Skyscanner API'den canlı sorgula
    process.stderr.write(`ℹ️  [${code}] Statik haritada bulunamadı, Skyscanner Autosuggest üzerinden dinamik aranıyor...\n`);
    const resolved = await this.fetchEntityFromAutosuggest(code);
    if (resolved && resolved.entityId) {
      process.stderr.write(`✅ [${code}] Dinamik olarak bulundu -> EntityId: ${resolved.entityId} (${resolved.name || ''})\n`);
      return resolved.entityId;
    }

    throw new Error(`Bilinmeyen havalimanı: ${iataCode}. Ne statik dosyada ne de Skyscanner Autosuggest servisinde bulunamadı.`);
  }

  private async makeRequest(method: string, path: string, body?: any): Promise<any> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'accept-language': `${this.locale},de;q=0.9`,
      'content-type': 'application/json',
      cookie: this.formatCookies(),
      origin: this.baseURL,
      referer: this.baseURL,
      'user-agent': this.userAgent,
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      maxStops = params.maxStops !== undefined ? params.maxStops : this.maxStops
    } = params;

    if (!origin || !destination || !outboundDate) {
      throw new Error('origin, destination, and outboundDate are required');
    }

    process.stderr.write(`\n🔍 Uçuş aranıyor: ${origin} → ${destination}\n`);
    process.stderr.write(`   Gidiş: ${outboundDate}${inboundDate ? `, Dönüş: ${inboundDate}` : ' (tek yön)'}\n`);
    process.stderr.write(`   ${adults} yolcu, ${cabinClass}\n\n`);

    const outbound = parseDate(outboundDate);
    const inbound = inboundDate ? parseDate(inboundDate) : null;

    const originEntityId = await this.getEntityId(origin);
    const destinationEntityId = await this.getEntityId(destination);

    const requestBody: any = {
      cabinClass: cabinClass.toUpperCase(),
      childAges: [],
      adults,
      preferDirects: maxStops === 0,
      legs: [
        {
          legOrigin: { '@type': 'entity', entityId: originEntityId },
          legDestination: { '@type': 'entity', entityId: destinationEntityId },
          dates: { '@type': 'date', ...outbound },
        },
      ],
    };

    if (inbound) {
      requestBody.legs.push({
        legOrigin: { '@type': 'entity', entityId: destinationEntityId },
        legDestination: { '@type': 'entity', entityId: originEntityId },
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
    const deadline = Date.now() + POLL_DEADLINE_MS;

    while (attempts < maxAttempts && Date.now() < deadline) {
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
          legs: (item.legs || []).map((leg: any) => {
            const segs = leg.segments || [];
            const segStops = segs.length > 0 ? segs.length - 1 : 0;
            const apiStops = typeof leg.stopCount === 'number' ? leg.stopCount : (typeof leg.stops === 'number' ? leg.stops : 0);
            const calculatedStops = Math.max(segStops, apiStops);

            return {
              origin: leg.origin?.displayCode || 'Unknown',
              destination: leg.destination?.displayCode || 'Unknown',
              departure: leg.departure || '',
              arrival: leg.arrival || '',
              duration: leg.durationInMinutes || 0,
              stops: calculatedStops,
              segments: segs.map((seg: any) => ({
                origin: seg.origin?.displayCode || 'Unknown',
                destination: seg.destination?.displayCode || 'Unknown',
                departure: seg.departure || '',
                arrival: seg.arrival || '',
                carrier: seg.marketingCarrier?.name || 'Unknown',
                carrierCode: seg.marketingCarrier?.alternateId || '',
                flightNumber: seg.flightNumber || '',
                duration: seg.durationInMinutes || 0,
              })),
            };
          }),
          deeplink: item.deeplink?.url || null,
        };
      })
      .filter((flight: Flight | null): flight is Flight => flight !== null)
      .filter((flight: Flight) => flight.legs.every((leg: any) => {
        const segCount = Array.isArray(leg.segments) ? leg.segments.length : 0;
        const stops = typeof leg.stops === 'number'
          ? Math.max(leg.stops, segCount > 0 ? segCount - 1 : 0)
          : (segCount > 0 ? segCount - 1 : 0);
        return stops <= this.maxStops;
      }));

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
  const rawArgs = process.argv.slice(2);

  // Flag'leri ayrıştır (--cookie <path>, --cookies <str>)
  let cookieFileArg: string | undefined;
  let cookiesArg: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--cookie' || a === '-c') {
      cookieFileArg = rawArgs[++i];
    } else if (a === '--cookies') {
      cookiesArg = rawArgs[++i];
    } else {
      args.push(a);
    }
  }

  // Havalimanı / entityId sorgulama modu:
  // bun run pusula.ts --lookup ADB
  if (args[0] === '--lookup' || args[0] === '-l') {
    const code = args[1];
    if (!code) {
      process.stderr.write('Kullanım: bun run pusula.ts --lookup <IATA>\n');
      process.exit(1);
    }
    const api = new SkyscannerAPI({ cookieFile: cookieFileArg, cookies: cookiesArg });
    try {
      const entityId = await api.getEntityId(code);
      const details = (api as any).staticAirports[code.toUpperCase()];
      process.stdout.write(JSON.stringify({ code: code.toUpperCase(), entityId, details: details || null }, null, 2) + '\n');
      process.exit(0);
    } catch (e: any) {
      process.stderr.write(`❌ ${e.message}\n`);
      process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
      process.exit(1);
    }
  }

  // Args: origin destination outboundDate [inboundDate] [adults] [maxStops]
  // Example: bun run pusula.ts ESB BCN 2026-04-10 - 1 0

  const origin = args[0] || 'ESB';
  const destination = args[1] || 'BCN';
  const outboundDate = args[2] || '2026-04-10';
  const inboundDate = args[3] && args[3] !== '-' ? args[3] : undefined;
  const adults = args[4] ? parseInt(args[4], 10) : 1;
  const maxStops = args[5] !== undefined ? parseInt(args[5], 10) : 0;

  process.stderr.write(`\n🔍 ${origin} → ${destination} | ${outboundDate}${inboundDate ? ' ↔ ' + inboundDate : ' (tek yön)'} | ${adults} yolcu | max ${maxStops} durak\n`);

  const api = new SkyscannerAPI({ maxStops, cookieFile: cookieFileArg, cookies: cookiesArg });

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
