'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { Booking, Flight, IdempotencyDemoResult, Passenger } from '@/lib/types';

function newKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export default function BookPage() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [flightId, setFlightId] = useState('');
  const [passengerId, setPassengerId] = useState('');
  const [seats, setSeats] = useState(1);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [idempotency, setIdempotency] = useState<IdempotencyDemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<Flight[]>('/api/flights'), api<Passenger[]>('/api/passengers')])
      .then(([nextFlights, nextPassengers]) => {
        setFlights(nextFlights);
        setPassengers(nextPassengers);
        const requested = new URLSearchParams(window.location.search).get('flight');
        setFlightId(
          nextFlights.find((flight) => flight.id === requested)?.id ||
            nextFlights.find((flight) => flight.flightNumber === 'CM055')?.id ||
            nextFlights[0]?.id ||
            '',
        );
        setPassengerId(nextPassengers[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setIdempotency(null);
    try {
      setBooking(
        await api<Booking>('/api/bookings', {
          method: 'POST',
          body: JSON.stringify({ flightId, passengerId, seats, idempotencyKey }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  }

  async function retryThree() {
    setBusy(true);
    setError(null);
    try {
      setIdempotency(
        await api<IdempotencyDemoResult>('/api/demo/idempotency?requestCount=3', {
          method: 'POST',
          body: JSON.stringify({ flightId, passengerId, seats, idempotencyKey }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry demo failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="eyebrow">Hold inventory</div>
      <h2>Book a seat</h2>
      <p className="lede">
        A booking decrements remaining seats inside one CamusDB transaction, then writes a PNR and a
        reserved event. Reuse the idempotency key to retry safely.
      </p>

      <div className="panel" style={{ marginTop: 24, maxWidth: 560 }}>
        <div className="form-grid">
          <label>
            Passenger
            <select value={passengerId} onChange={(event) => setPassengerId(event.target.value)}>
              {passengers.map((passenger) => (
                <option key={passenger.id} value={passenger.id}>
                  {passenger.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Flight
            <select value={flightId} onChange={(event) => setFlightId(event.target.value)}>
              {flights.map((flight) => (
                <option key={flight.id} value={flight.id}>
                  {flight.flightNumber} {flight.origin}→{flight.destination} · {flight.seatsAvailable} open
                </option>
              ))}
            </select>
          </label>
          <label>
            Seats
            <input type="number" min={1} value={seats} onChange={(event) => setSeats(Number(event.target.value))} />
          </label>
          <label>
            Idempotency key
            <input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} />
          </label>
        </div>
        <div className="stack">
          <button className="primary" onClick={submit} disabled={busy}>
            Confirm booking
          </button>
          <button className="ghost" onClick={() => setIdempotencyKey(newKey())}>
            New key
          </button>
          <button className="ghost" onClick={retryThree} disabled={busy}>
            Retry 3×
          </button>
        </div>
        {booking && (
          <div className="alert">
            PNR {booking.pnr} confirmed · {booking.seats} seat{booking.seats === 1 ? '' : 's'} · ${booking.total}
          </div>
        )}
        {idempotency && (
          <div className="alert">
            Requests: {idempotency.requests}, bookings: {idempotency.bookings}, PNR {idempotency.booking.pnr}
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
      </div>
    </div>
  );
}
