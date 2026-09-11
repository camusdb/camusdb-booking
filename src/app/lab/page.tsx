'use client';

import { useEffect, useState } from 'react';
import { api, getDatabase, setDatabase } from '@/lib/client/api';
import type {
  BranchInfo,
  CamusHealth,
  ConcurrentDemoResult,
  ExplainResult,
  FailureInjectionResult,
  FailurePoint,
  Flight,
  OrphanInfo,
  Passenger,
} from '@/lib/types';

const failurePoints: FailurePoint[] = ['afterRead', 'afterSeatHold', 'beforeEventInsert', 'beforeCommit'];

export default function LabPage() {
  const [health, setHealth] = useState<CamusHealth | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [orphans, setOrphans] = useState<OrphanInfo[]>([]);
  const [branchName, setBranchName] = useState('what-if-inventory');
  const [current, setCurrent] = useState(getDatabase());
  const [flightId, setFlightId] = useState('');
  const [passengerId, setPassengerId] = useState('');
  const [concurrency, setConcurrency] = useState(50);
  const [concurrent, setConcurrent] = useState<ConcurrentDemoResult | null>(null);
  const [failurePoint, setFailurePoint] = useState<FailurePoint>('beforeCommit');
  const [failure, setFailure] = useState<FailureInjectionResult | null>(null);
  const [asOf, setAsOf] = useState('-30s');
  const [historical, setHistorical] = useState<Flight | null>(null);
  const [explainSql, setExplainSql] = useState('SELECT flight_number, seats_available FROM flights');
  const [plan, setPlan] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [nextHealth, nextFlights, nextPassengers, nextBranches] = await Promise.all([
      api<CamusHealth>('/api/camus/health'),
      api<Flight[]>('/api/flights'),
      api<Passenger[]>('/api/passengers'),
      api<BranchInfo[]>('/api/camus/branches'),
    ]);
    setHealth(nextHealth);
    setFlights(nextFlights);
    setPassengers(nextPassengers);
    setBranches(nextBranches);
    setFlightId((currentId) => currentId || nextFlights.find((flight) => flight.flightNumber === 'CM055')?.id || nextFlights[0]?.id || '');
    setPassengerId((currentId) => currentId || nextPassengers[0]?.id || '');
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(err.message));
  }, []);

  async function switchBranch(database: string) {
    setDatabase(database);
    setCurrent(database);
    await api('/api/camus/branches/switch', { method: 'POST', body: JSON.stringify({ database }) });
    await reload();
  }

  return (
    <div className="page">
      <div className="eyebrow">Operator tools</div>
      <h2>CamusDB Lab</h2>
      <p className="lede">
        Current database: <strong>{current}</strong>. Branch, race the last seats, inject a failure, and recover an orphan table.
      </p>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert">{message}</div>}

      <div className="lab-grid" style={{ marginTop: 24 }}>
        <section className="panel">
          <h3>Cluster health</h3>
          {health && (
            <>
              <p className="muted">Endpoint: {health.endpoint}</p>
              <p className="muted">Database: {health.database}</p>
              <p>{health.ok ? 'Healthy' : 'Unreachable'}</p>
            </>
          )}
          <div className="stack">
            <button className="ghost" onClick={() => reload().catch((err: Error) => setError(err.message))}>
              Refresh
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>Database branching</h3>
          <label>
            Branch name
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} />
          </label>
          <div className="stack">
            <button
              className="primary"
              onClick={async () => {
                await api('/api/camus/branches', { method: 'POST', body: JSON.stringify({ name: branchName }) });
                await reload();
                setMessage(`Created branch ${branchName}`);
              }}
            >
              Create branch
            </button>
            <button className="ghost" onClick={() => switchBranch('camusbooking')}>
              Switch to main
            </button>
          </div>
          {branches.map((branch) => (
            <div key={branch.name} className="stack" style={{ marginTop: 8 }}>
              <span>
                {branch.name} <span className="muted">parent {branch.parent ?? '—'} depth {branch.depth}</span>
              </span>
              <button className="ghost" onClick={() => switchBranch(branch.name)}>
                Switch
              </button>
              <button
                className="danger"
                onClick={async () => {
                  await api(`/api/camus/branches/${encodeURIComponent(branch.name)}`, { method: 'DELETE' });
                  if (current === branch.name) await switchBranch('camusbooking');
                  else await reload();
                }}
              >
                Drop
              </button>
            </div>
          ))}
        </section>

        <section className="panel">
          <h3>Concurrent booking</h3>
          <p className="muted">Many clients take one seat on the same flight. Only remaining inventory should commit.</p>
          <label>
            Flight
            <select value={flightId} onChange={(event) => setFlightId(event.target.value)}>
              {flights.map((flight) => (
                <option key={flight.id} value={flight.id}>
                  {flight.flightNumber} · {flight.seatsAvailable} open
                </option>
              ))}
            </select>
          </label>
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
            Concurrency
            <input type="number" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
          </label>
          <div className="stack">
            <button
              className="primary"
              onClick={async () => {
                setError(null);
                setConcurrent(
                  await api<ConcurrentDemoResult>('/api/demo/concurrent', {
                    method: 'POST',
                    body: JSON.stringify({ flightId, passengerId, concurrency }),
                  }),
                );
                await reload();
              }}
            >
              Run demo
            </button>
          </div>
          {concurrent && (
            <div className="alert">
              Attempted {concurrent.attempted}, succeeded {concurrent.succeeded}, rejected {concurrent.rejected}.
              Seats {concurrent.seatsBefore} → {concurrent.seatsAfter}.
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Failure injection</h3>
          <label>
            Failure point
            <select value={failurePoint} onChange={(event) => setFailurePoint(event.target.value as FailurePoint)}>
              {failurePoints.map((point) => (
                <option key={point} value={point}>
                  {point}
                </option>
              ))}
            </select>
          </label>
          <div className="stack">
            <button
              className="ghost"
              onClick={async () => {
                setFailure(
                  await api<FailureInjectionResult>('/api/demo/failure', {
                    method: 'POST',
                    body: JSON.stringify({
                      flightId,
                      passengerId,
                      seats: 1,
                      idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
                      failurePoint,
                    }),
                  }),
                );
                await reload();
              }}
            >
              Inject failure
            </button>
          </div>
          {failure && (
            <div className="alert">
              Rolled back: {String(failure.rolledBack)}. Seats {failure.seatsBefore} → {failure.seatsAfter}. New events: {failure.eventsCreated}.
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Time machine</h3>
          <label>
            As of
            <input value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <div className="stack">
            <button
              className="ghost"
              onClick={async () => {
                setHistorical(await api<Flight>(`/api/camus/time-travel/flights/${flightId}?asOf=${encodeURIComponent(asOf)}`));
              }}
            >
              View historical seats
            </button>
            <button
              className="danger"
              onClick={async () => {
                await api('/api/camus/drop-table', { method: 'POST', body: JSON.stringify({ mode: 'row', flightId }) });
                setMessage('Deleted the flight row. Read it back with time travel, or recover from the board.');
                await reload();
              }}
            >
              Delete flight (demo)
            </button>
          </div>
          {historical && (
            <div className="alert">
              {historical.flightNumber} had {historical.seatsAvailable} seats at {asOf}.
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Orphan recovery</h3>
          <div className="stack">
            <button
              className="danger"
              onClick={async () => {
                await api('/api/camus/drop-table', { method: 'POST', body: JSON.stringify({ mode: 'table' }) });
                setMessage('Dropped table flights. List orphans and relink it.');
              }}
            >
              Drop flights table
            </button>
            <button className="ghost" onClick={async () => setOrphans(await api<OrphanInfo[]>('/api/camus/orphans'))}>
              List orphans
            </button>
          </div>
          {orphans.map((orphan) => (
            <div key={orphan.id} className="stack">
              <span>
                {orphan.formerName} · {orphan.kind}
              </span>
              <button
                className="primary"
                onClick={async () => {
                  await api('/api/camus/recover', {
                    method: 'POST',
                    body: JSON.stringify({ newTableName: orphan.formerName || 'flights', orphanId: orphan.id }),
                  });
                  setMessage(`Relinked ${orphan.formerName}`);
                  await reload();
                }}
              >
                Recover
              </button>
            </div>
          ))}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h3>EXPLAIN</h3>
        <textarea rows={3} value={explainSql} onChange={(event) => setExplainSql(event.target.value)} />
        <div className="stack">
          <button
            className="ghost"
            onClick={async () => {
              const result = await api<ExplainResult>(`/api/camus/explain?sql=${encodeURIComponent(explainSql)}`);
              setPlan(result.plan);
            }}
          >
            Run EXPLAIN
          </button>
        </div>
        {plan && <pre className="plan">{plan}</pre>}
      </section>
    </div>
  );
}
