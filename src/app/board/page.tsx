'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import type { BookingEvent, Flight, SeedSummary } from '@/lib/types';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function BoardPage() {
  const router = useRouter();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const [summary, setSummary] = useState<SeedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Flight[]>('/api/flights'),
      api<BookingEvent[]>('/api/events?limit=8'),
      api<SeedSummary & { database: string }>('/api/summary'),
    ])
      .then(([nextFlights, nextEvents, nextSummary]) => {
        setFlights(nextFlights);
        setEvents(nextEvents);
        setSummary(nextSummary);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const openSeats = flights.reduce((sum, flight) => sum + flight.seatsAvailable, 0);

  return (
    <div className="page">
      <div className="eyebrow">Live inventory</div>
      <h2>Departures</h2>
      <p className="lede">Fake Camus Air, Atlantic North, Pacific Loop, and Serra Lines inventory held in CamusDB.</p>

      {loading && <p className="muted">Loading the LIS desk…</p>}
      {error && <div className="alert error">{error}</div>}

      <div className="metrics">
        <div className="metric">
          <span>Open seats</span>
          <strong>{openSeats}</strong>
        </div>
        <div className="metric">
          <span>Flights</span>
          <strong>{flights.length}</strong>
        </div>
        <div className="metric">
          <span>PNRs</span>
          <strong>{summary?.bookingCount ?? '—'}</strong>
        </div>
      </div>

      <div className="board">
        <div className="board-head">
          <span>CamusBooking · LIS desk</span>
          <span>on time</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Flight</th>
              <th>From</th>
              <th>To</th>
              <th>Departs</th>
              <th>Cabin</th>
              <th>Seats</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((flight) => (
              <tr key={flight.id} onClick={() => router.push(`/flights/${flight.id}`)}>
                <td>{flight.flightNumber}</td>
                <td>{flight.origin}</td>
                <td>{flight.destination}</td>
                <td>{formatTime(flight.departsAt)}</td>
                <td>{flight.cabin}</td>
                <td className={flight.seatsAvailable <= 2 ? 'seats-low' : 'seats-ok'}>
                  {flight.seatsAvailable}/{flight.seatsTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h3>Recent movement</h3>
        {events.length === 0 && <p className="muted">No booking events yet.</p>}
        {events.map((event) => (
          <p key={event.id} className="muted">
            {event.eventType} · {event.seats} seat{event.seats === 1 ? '' : 's'} · {new Date(event.createdAt).toLocaleString()}
          </p>
        ))}
        <div className="stack">
          <Link className="primary" href="/book">
            Book a seat
          </Link>
        </div>
      </div>
    </div>
  );
}
