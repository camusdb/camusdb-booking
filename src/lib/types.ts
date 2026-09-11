export type FlightStatus = 'scheduled' | 'boarding' | 'departed' | 'cancelled';
export type BookingStatus = 'confirmed' | 'cancelled';
export type FailurePoint = 'afterRead' | 'afterSeatHold' | 'beforeEventInsert' | 'beforeCommit';

export interface Passenger {
  id: string;
  name: string;
  email: string;
}

export interface Flight {
  id: string;
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  departsAt: string;
  arrivesAt: string;
  cabin: string;
  fare: number;
  seatsTotal: number;
  seatsAvailable: number;
  status: FlightStatus;
  createdAt: string;
}

export interface Booking {
  id: string;
  passengerId: string;
  flightId: string;
  seats: number;
  total: number;
  status: BookingStatus;
  pnr: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface BookingEvent {
  id: string;
  bookingId: string | null;
  flightId: string;
  eventType: string;
  seats: number;
  createdAt: string;
}

export interface CreateBookingRequest {
  passengerId: string;
  flightId: string;
  seats: number;
  idempotencyKey?: string;
}

export interface BranchInfo {
  name: string;
  parent: string | null;
  depth: number;
  forkTimestamp: string | null;
}

export interface OrphanInfo {
  id: string;
  formerName: string;
  droppedAt: string;
  expiresAt: string;
  kind: string;
}

export interface SeedSummary {
  passengers: Passenger[];
  flights: Flight[];
  bookingCount: number;
}

export interface ConcurrentDemoResult {
  attempted: number;
  succeeded: number;
  rejected: number;
  seatsBefore: number;
  seatsAfter: number;
}

export interface IdempotencyDemoResult {
  requests: number;
  bookings: number;
  booking: Booking;
}

export interface FailureInjectionResult {
  rolledBack: boolean;
  seatsBefore: number;
  seatsAfter: number;
  eventsCreated: number;
}

export interface CamusHealth {
  ok: boolean;
  endpoint: string;
  database: string;
}

export interface ExplainResult {
  sql: string;
  plan: string;
}
