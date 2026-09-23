export type FlightStatus = 'scheduled' | 'boarding' | 'departed' | 'cancelled';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'payment_failed' | 'cancelled';
export type FailurePoint = 'afterRead' | 'afterSeatHold' | 'beforeEventInsert' | 'beforeOutboxInsert' | 'beforeCommit';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refund_pending' | 'refunded';
export type OutboxStatus = 'pending' | 'sent' | 'dead';
export type OutboxTopic = 'payment.requested' | 'refund.requested';

/** Test payment methods, named after the Stripe test cards they copy. */
export type PaymentMethod = 'pm_card_visa' | 'pm_card_chargeDeclined' | 'pm_card_chargeDeclinedInsufficientFunds';

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
  paymentMethod?: PaymentMethod;
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
  outboxCreated: number;
}

export interface Payment {
  id: string;
  bookingId: string;
  intentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutboxMessage {
  id: string;
  aggregateId: string;
  topic: OutboxTopic;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelayState {
  running: boolean;
  paused: boolean;
  crashAfterPublish: boolean;
  lastTickAt: string | null;
  lastError: string | null;
  published: number;
}

export interface OutboxOverview {
  relay: RelayState;
  messages: OutboxMessage[];
}

export interface BookingDetail extends Booking {
  payment: Payment | null;
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
