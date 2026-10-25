import { CamusClient, CamusObjectId, camus } from 'camusdb';
import { camusEndpoint, getClient, rootDatabase } from '@/lib/camus/client';

/** True when a CamusDB node answers. The integration tests skip without one. */
export async function camusUp(): Promise<boolean> {
  try {
    return await new CamusClient({ endpoint: camusEndpoint(), database: rootDatabase(), timeoutSeconds: 3 }).ping();
  } catch {
    return false;
  }
}

/** Inserts a flight of its own for one test, so that tests never compete for seats. Returns its id. */
export async function newFlight(seats: number): Promise<string> {
  const id = CamusObjectId.generateAsString();
  const departs = new Date(Date.now() + 86_400_000);
  await getClient().insert('flights', {
    id: camus.id(id),
    flight_number: `T${id.slice(-8)}`,
    airline: 'Test Air',
    origin: 'AAA',
    destination: 'BBB',
    departs_at: departs,
    arrives_at: new Date(departs.getTime() + 3_600_000),
    cabin: 'economy',
    fare: camus.float64(100),
    seats_total: seats,
    seats_available: seats,
    status: 'scheduled',
    created_at: new Date(),
  });
  return id;
}
