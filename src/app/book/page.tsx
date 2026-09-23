'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { Booking, BookingDetail, Flight, IdempotencyDemoResult, Passenger, PaymentMethod } from '@/lib/types';

const cards: { value: PaymentMethod; label: string }[] = [
  { value: 'pm_card_visa', label: 'Visa · succeeds' },
  { value: 'pm_card_chargeDeclined', label: 'Visa · declined' },
  { value: 'pm_card_chargeDeclinedInsufficientFunds', label: 'Visa · insufficient funds' },
];

const statusText: Record<Booking['status'], string> = {
  pending_payment: 'seats held · waiting for payment',
  confirmed: 'confirmed · payment captured',
  payment_failed: 'payment failed · seats released',
  cancelled: 'cancelled',
};

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pm_card_visa');
  const [booking, setBooking] = useState<BookingDetail | null>(null);
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

  // The payment completes after the booking returns, so ask for the booking until it leaves pending.
  useEffect(() => {
    if (!booking || booking.status !== 'pending_payment') return;
    const timer = setTimeout(() => {
      api<BookingDetail>(`/api/bookings/${booking.id}`)
        .then(setBooking)
        .catch((err: Error) => setError(err.message));
    }, 750);
    return () => clearTimeout(timer);
  }, [booking]);

  async function submit() {
    setBusy(true);
    setError(null);
    setIdempotency(null);
    try {
      const created = await api<Booking>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ flightId, passengerId, seats, idempotencyKey, paymentMethod }),
      });
      setBooking({ ...created, payment: null });
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
          body: JSON.stringify({ flightId, passengerId, seats, idempotencyKey, paymentMethod }),
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
        A booking holds the seats, writes a PNR, a reserved event, and a payment request to the outbox,
        all in one CamusDB transaction. The relay sends the request to the payment gateway, and the
        gateway webhook confirms the booking or releases the seats. Reuse the idempotency key to retry
        safely.
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
            Card
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              {cards.map((card) => (
                <option key={card.value} value={card.value}>
                  {card.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Idempotency key
            <input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} />
          </label>
        </div>
        <div className="stack">
          <button className="primary" onClick={submit} disabled={busy}>
            Book and pay
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
            PNR {booking.pnr} {statusText[booking.status]} · {booking.seats} seat{booking.seats === 1 ? '' : 's'} · $
            {booking.total}
            {booking.payment?.intentId && <div className="muted">Payment intent {booking.payment.intentId}</div>}
            {booking.payment?.failureReason && <div className="muted">Reason: {booking.payment.failureReason}</div>}
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
