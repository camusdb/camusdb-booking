'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { GatewaySnapshot } from '@/lib/payments/gateway';
import type { OutboxOverview, RelayState } from '@/lib/types';

function age(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function cents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

export default function PaymentsLab({ onChange }: { onChange?: () => void }) {
  const [outbox, setOutbox] = useState<OutboxOverview | null>(null);
  const [gateway, setGateway] = useState<GatewaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [nextOutbox, nextGateway] = await Promise.all([
      api<OutboxOverview>('/api/outbox?limit=12'),
      api<GatewaySnapshot>('/api/gateway/state'),
    ]);
    setOutbox(nextOutbox);
    setGateway(nextGateway);
  }

  useEffect(() => {
    const tick = () => refresh().then(() => setError(null)).catch((err: Error) => setError(err.message));
    tick();
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }, []);

  async function relay(action: 'pause' | 'resume' | 'drain' | 'crashAfterPublish') {
    await api<RelayState>('/api/outbox', { method: 'POST', body: JSON.stringify({ action }) });
    await refresh();
    onChange?.();
  }

  async function configure(patch: Partial<GatewaySnapshot['config']>) {
    setGateway(await api<GatewaySnapshot>('/api/gateway/state', { method: 'POST', body: JSON.stringify(patch) }));
  }

  const state = outbox?.relay;
  const config = gateway?.config;

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h3>Payments and outbox</h3>
      <p className="muted">
        Each booking writes a payment request to the outbox in its own transaction. The relay sends it to the fake
        gateway with the outbox id as the idempotency key. The gateway answers through a signed webhook, which
        confirms the booking or releases its seats. Pause the relay to watch requests wait, crash it after a gateway
        call to see the idempotent retry, or make the gateway fail to see backoff and the dead-letter path.
      </p>
      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        {state && (
          <span className="muted">
            Relay {state.paused ? 'paused' : state.running ? 'running' : 'stopped'} · published {state.published}
            {state.crashAfterPublish && ' · crash armed'}
          </span>
        )}
      </div>
      <div className="stack">
        <button className="ghost" onClick={() => relay(state?.paused ? 'resume' : 'pause')}>
          {state?.paused ? 'Resume relay' : 'Pause relay'}
        </button>
        <button className="ghost" onClick={() => relay('drain')}>
          Drain now
        </button>
        <button className="danger" onClick={() => relay('crashAfterPublish')}>
          Crash after next gateway call
        </button>
        <button className={config?.unavailable ? 'primary' : 'ghost'} onClick={() => configure({ unavailable: !config?.unavailable })}>
          Gateway outage: {config?.unavailable ? 'on' : 'off'}
        </button>
        <button
          className={config?.duplicateWebhooks ? 'primary' : 'ghost'}
          onClick={() => configure({ duplicateWebhooks: !config?.duplicateWebhooks })}
        >
          Duplicate webhooks: {config?.duplicateWebhooks ? 'on' : 'off'}
        </button>
      </div>
      {state?.lastError && <div className="alert error">Relay: {state.lastError}</div>}

      <div className="ledger-grid">
        <div className="ledger">
          <h3>Outbox</h3>
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Status</th>
                <th>Tries</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {outbox?.messages.map((message) => (
                <tr key={message.id} title={message.lastError || undefined}>
                  <td>{message.topic}</td>
                  <td>
                    {message.status}
                    {message.lastError && <div className="muted">{message.lastError}</div>}
                  </td>
                  <td>{message.attempts}</td>
                  <td>{age(message.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ledger">
          <h3>Gateway intents</h3>
          <table>
            <thead>
              <tr>
                <th>Intent</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Requests</th>
              </tr>
            </thead>
            <tbody>
              {gateway?.intents.map((intent) => (
                <tr key={intent.id}>
                  <td>
                    <code>{intent.id}</code>
                    <div className="muted">PNR {intent.metadata.pnr}</div>
                  </td>
                  <td>
                    {cents(intent.amount)}
                    {intent.amount_refunded > 0 && <div className="muted">refunded</div>}
                  </td>
                  <td>{intent.last_payment_error?.code ?? intent.status}</td>
                  <td>{intent.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ledger">
          <h3>Webhook deliveries</h3>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Try</th>
                <th>HTTP</th>
              </tr>
            </thead>
            <tbody>
              {gateway?.deliveries.map((delivery, index) => (
                <tr key={`${delivery.eventId}-${delivery.at}-${index}`} title={delivery.error ?? undefined}>
                  <td>
                    {delivery.type.replace('payment_intent.', '')}
                    <div className="muted">
                      <code>{delivery.eventId}</code>
                    </div>
                  </td>
                  <td>{delivery.attempt}</td>
                  <td>{delivery.httpStatus ?? 'error'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
