import { CamusObjectId, camus, type CamusClient, type CamusTransaction } from 'camusdb';

export interface NewBookingEvent {
  bookingId: string;
  flightId: string;
  eventType: string;
  seats: number;
}

/** Appends one row to the `booking_events` audit trail, inside the caller's transaction. */
export async function recordEvent(client: CamusClient, txn: CamusTransaction, event: NewBookingEvent): Promise<void> {
  await client.insert(
    'booking_events',
    {
      id: camus.id(CamusObjectId.generateAsString()),
      booking_id: camus.id(event.bookingId),
      flight_id: camus.id(event.flightId),
      event_type: event.eventType,
      seats: event.seats,
      created_at: new Date(),
    },
    { transaction: txn },
  );
}
