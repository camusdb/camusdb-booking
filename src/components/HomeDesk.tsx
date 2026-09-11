'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import type { Flight } from '@/lib/types';

const CITIES: Record<string, string> = {
  LIS: 'Lisbon',
  JFK: 'New York',
  LHR: 'London',
  SFO: 'San Francisco',
  GRU: 'São Paulo',
  NRT: 'Tokyo',
  CDG: 'Paris',
};

function city(code: string): string {
  return CITIES[code] ?? code;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function HomeDesk() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [origin, setOrigin] = useState('LIS');
  const [destination, setDestination] = useState('');
  const [queried, setQueried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Flight[]>('/api/flights')
      .then(setFlights)
      .catch((err: Error) => setError(err.message));
  }, []);

  const origins = useMemo(() => uniqueSorted(flights.map((flight) => flight.origin)), [flights]);
  const destinations = useMemo(() => {
    const fromOrigin = flights.filter((flight) => !origin || flight.origin === origin);
    return uniqueSorted(fromOrigin.map((flight) => flight.destination));
  }, [flights, origin]);

  useEffect(() => {
    if (destination && !destinations.includes(destination)) setDestination('');
  }, [destination, destinations]);

  const results = useMemo(() => {
    return flights.filter((flight) => {
      if (origin && flight.origin !== origin) return false;
      if (destination && flight.destination !== destination) return false;
      return true;
    });
  }, [flights, origin, destination]);

  function search(event: FormEvent) {
    event.preventDefault();
    setQueried(true);
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function swap() {
    if (!destination) return;
    const nextOrigin = destination;
    setDestination(origin);
    setOrigin(nextOrigin);
  }

  return (
    <>
      <section className="hero-bleed">
        <Image src="/hero-landscape.png" alt="" fill priority sizes="100vw" className="hero-media" />
        <div className="hero-copy">
          <h1>CamusBooking</h1>
          <p className="lede">Search the desk, hold the last seats, and retry a PNR without guessing.</p>
          <form className="search-bar" onSubmit={search}>
            <label>
              From
              <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
                <option value="">Any origin</option>
                {origins.map((code) => (
                  <option key={code} value={code}>
                    {code} · {city(code)}
                  </option>
                ))}
              </select>
            </label>
            <button className="search-swap" type="button" onClick={swap} aria-label="Swap origin and destination">
              ⇄
            </button>
            <label>
              To
              <select value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">Any destination</option>
                {destinations.map((code) => (
                  <option key={code} value={code}>
                    {code} · {city(code)}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit">
              Search flights
            </button>
          </form>
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="news-pill">Serializable seat inventory</div>
      </section>

      <section className="band" id="results">
        <div className="page-inner">
          {queried ? (
            <>
              <div className="eyebrow">
                {origin || 'Any'} → {destination || 'Any'}
              </div>
              <h2>{results.length === 1 ? '1 flight' : `${results.length} flights`}</h2>
              {results.length === 0 && (
                <p className="lede">No flights on that route. Try Lisbon to New York, or Lisbon to Paris.</p>
              )}
              <div className="flight-results">
                {results.map((flight) => (
                  <article key={flight.id} className="flight-result">
                    <div>
                      <strong>
                        {flight.origin} → {flight.destination}
                      </strong>
                      <p>
                        {flight.flightNumber} · {flight.airline} · {formatTime(flight.departsAt)} · {flight.cabin}
                      </p>
                    </div>
                    <div className="flight-result-meta">
                      <span>
                        {flight.seatsAvailable} of {flight.seatsTotal} open
                      </span>
                      <strong>${flight.fare}</strong>
                    </div>
                    <div className="stack">
                      <Link className="primary" href={`/book?flight=${flight.id}`}>
                        Book
                      </Link>
                      <Link className="ghost" href={`/flights/${flight.id}`}>
                        Details
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="metrics" style={{ margin: 0 }}>
              <div className="metric">
                <span>Last-seat races</span>
                <strong>CM055</strong>
              </div>
              <div className="metric">
                <span>Idempotent retries</span>
                <strong>1 PNR</strong>
              </div>
              <div className="metric">
                <span>Time travel</span>
                <strong>−30s</strong>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="band band-alt">
        <div className="page-inner">
          <div className="features">
            <article className="card">
              <h3>Last-seat races</h3>
              <p>Fifty clients try to take CM055’s two remaining seats. Serializable transactions keep the cabin honest.</p>
            </article>
            <article className="card">
              <h3>Idempotent PNRs</h3>
              <p>Retry a booking three times with the same key. CamusDB’s unique index makes it one reservation.</p>
            </article>
            <article className="card">
              <h3>Time travel</h3>
              <p>Read a flight as of -30s, drop a table, and relink the orphan — the same tools as the CamusBank lab.</p>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
