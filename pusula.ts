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
  }

  private maxStops: number = 99;

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
            }
          });

          console.log(`✅ ${Object.keys(cookies).length} cookies loaded from JSON`);
          return cookies;
        } catch (e) {
          // If JSON parse fails, maybe it's actually Netscape format even if it looks like JSON
        }
      }

      // Handle Netscape format (tab-separated)
      content.split('\n').forEach((line: string) => {
        if (line.startsWith('#') || !line.trim()) return;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          cookies[parts[5]] = parts[6];
        }
      });

      console.log(`✅ ${Object.keys(cookies).length} cookies loaded from Netscape format`);
      return cookies;
    } catch (error) {
      console.log('⚠️  No cookies found or error reading file');
      return {};
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
      MUC: '95673626', BER: '95673294', DUS: '95673542', CDG: '95565040',
      MAD: '95673609', FCO: '95673538', BCN: '95565085', VIE: '95673696',
      ZRH: '95673709', JFK: '95565053', LAX: '95673605', ORD: '95565049',
      SFO: '95673685', MIA: '95673615', DXB: '95673544', SIN: '95673686',
      HKG: '95673573', NRT: '95673639', SYD: '95673690',
      ESB: '128668440',
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

    console.log('\n🔍 Searching flights...');
    console.log(`   ${origin} → ${destination}`);
    console.log(`   Departure: ${outboundDate}${inboundDate ? `, Return: ${inboundDate}` : ' (one-way)'}`);
    console.log(`   ${adults} passenger(s), ${cabinClass}\n`);

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
    console.log('📡 Sending request...');
    const searchResponse = await this.makeRequest('POST', '/g/radar/api/v2/web-unified-search/', requestBody);

    const sessionId = searchResponse.context?.sessionId;
    if (!sessionId) {
      throw new Error('No session ID received');
    }

    console.log(`✅ Session: ${sessionId.substring(0, 30)}...\n`);
    return await this.pollResults(sessionId);
  }

  private async pollResults(sessionId: string): Promise<SearchResults> {
    console.log('⏳ Waiting for all results...\n');

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;

      const delay = Math.floor(Math.random() * (40000 - 30000 + 1)) + 30000;
      console.log(`\n⏳ Wait #${attempts}: Sleeping for ${Math.round(delay / 1000)}s before polling...`);
      await sleep(delay);

      const response = await this.makeRequest('GET', `/g/radar/api/v2/web-unified-search/${sessionId}`);

      const status = response.context?.status;
      const results = response.itineraries?.results || [];

      console.log(`   Poll #${attempts}: ${status} - ${results.length} flights`);

      if (status === 'complete') {
        console.log('\n✅ All results ready!\n');
        return this.parseResults(response);
      }
    }

    console.log('\n⚠️  Timeout, returning partial results\n');
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
// EXAMPLE USAGE (if run directly)
// ============================================================================

if (import.meta.main) {
  const api = new SkyscannerAPI();

  const results = await api.searchFlights({
    origin: 'ESB',
    destination: 'BCN',
    outboundDate: '2026-03-25',
    adults: 1,
    maxStops: 0,
  });

  console.log(`Found ${results.totalResults} flights\n`);

  results.flights.slice(0, 5).forEach((flight, i) => {
    console.log(`${i + 1}. ${flight.price.formatted}`);
    console.log(`   ${flight.legs[0].origin} → ${flight.legs[0].destination}`);
    console.log(`   ${flight.legs[0].duration}min, ${flight.legs[0].stops} stops`);
    console.log(`   ${flight.legs[0].segments[0]?.carrier}\n`);
  });
}
