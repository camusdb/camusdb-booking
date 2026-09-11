'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client/api';
import type { Booking, Flight } from '@/lib/types';

export default function FlightPage() {
  const { id } = useParams<{ id: string }>();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const payload = await api<{ flight: Flight; bookings: Booking[] }>(`/api/flights/${id}`);
    setFlight(payload.flight);
    setBookings(payload.bookings);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function cancel(bookingId: string) {
    setError(null);
    try {
      await api(`/api/bookings/${bookingId}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  if (!flight) {
    return (
      <div className="page">
        {error ? <div className="alert error">{error}</div> : <p className="muted">Loading flight…</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="eyebrow">{flight.airline}</div>
      <h2>
        {flight.flightNumber} {flight.origin} → {flight.destination}
      </h2>
      <p className="lede">
        {flight.cabin} · ${flight.fare} · {flight.seatsAvailable} of {flight.seatsTotal} seats still open
      </p>
      {error && <div className="alert error">{error}</div>}

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>PNRs on this flight</h3>
        {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
        {bookings.map((booking) => (
          <div key={booking.id} className="row">
            <div>
              <strong>{booking.pnr}</strong>
              <div className="muted">
                {booking.status} · {booking.seats} seat{booking.seats === 1 ? '' : 's'} · ${booking.total}
              </div>
            </div>
            {booking.status === 'confirmed' && (
              <button className="danger" onClick={() => cancel(booking.id)}>
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
