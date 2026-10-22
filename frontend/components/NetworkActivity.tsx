'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetworkActivityResponse, NetworkDetails } from '@reelcraft/shared';
import { getNetworkActivity, getNetworkDetails, changeNetworkRestriction } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Dialog } from './ui/Dialog';

export function NetworkActivity() {
  const { user, loading, getToken } = useAuth();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<NetworkActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const id = ++sequence.current;
      setBusy(true);
      setError(null);
      try {
        const result = await getNetworkActivity(await getToken(), day, cursor);
        if (id === sequence.current)
          setData((previous) => ({
            ...result,
            items: cursor && previous ? [...previous.items, ...result.items] : result.items,
          }));
      } catch (err) {
        if (id === sequence.current) {
          setError((err as Error).message);
          setData(null);
        }
      } finally {
        if (id === sequence.current) setBusy(false);
      }
    },
    [day, getToken],
  );
  useEffect(() => {
    setData(null);
    if (user) void load();
    return () => {
      sequence.current++;
    };
  }, [user, load]);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REELCRAFT / NETWORK ACTIVITY</span>
          <h1>
            Network activity<span className="mint">.</span>
          </h1>
          <p>AI request activity by network, with country and ASN information.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Checking your sign-in...</p>
      ) : !user ? (
        <div className="empty-state">
          <h2>Sign in to view network activity</h2>
          <p>A support or admin account is required.</p>
          <a className="button primary" href="/login">
            Sign in
          </a>
        </div>
      ) : (
        <>
          <div className="table-toolbar">
            <label className="field">
              Activity date (UTC)
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  setSelected(null);
                  if (e.target.value) setDay(e.target.value);
                }}
              />
            </label>
            <button className="button secondary" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {busy && <p role="status">Loading network activity...</p>}
          {data && (
            <>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>IP hash / country</th>
                      <th>Network / ASN</th>
                      <th>Accounts</th>
                      <th>Requests</th>
                      <th>Status</th>
                      <th>Management</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.ipHash}>
                        <td>
                          <strong>{row.ipHash}</strong>
                          <small>{row.country ?? row.countryCode ?? 'Unknown country'}</small>
                        </td>
                        <td>
                          {row.asName ?? 'Unknown network'}
                          <small>{row.asn ?? 'ASN unavailable'}</small>
                        </td>
                        <td>{row.accountCount}</td>
                        <td>{row.requests}</td>
                        <td>
                          <span
                            className={`status-pill ${row.flagged || (row.blockedUntil ?? 0) > Date.now() ? 'draft' : 'ready'}`}
                          >
                            {(row.blockedUntil ?? 0) > Date.now()
                              ? `Blocked until ${new Date(row.blockedUntil!).toLocaleString()}`
                              : row.flagged
                                ? 'ASN watchlist'
                                : row.lookupStatus === 'ok'
                                  ? 'No watchlist match'
                                  : row.lookupStatus === 'private'
                                    ? 'Local / private'
                                    : 'Lookup unavailable'}
                          </span>
                        </td>
                        <td>
                          <button className="text-link" onClick={() => setSelected(row.ipHash)}>
                            Accounts & restrictions
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.items.length && (
                <div className="empty-state">
                  <h2>No network activity</h2>
                  <p>No recorded AI requests for this UTC day.</p>
                </div>
              )}
              {data.nextCursor && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void load(data.nextCursor!)}
                >
                  Load more
                </button>
              )}
            </>
          )}
        </>
      )}
      <p className="fine-print">
        IP data by{' '}
        <a href="https://ipinfo.io" target="_blank" rel="noreferrer">
          IPinfo
        </a>
        . Watchlist matches require additional verification. They do not prove VPN use or abuse.
        Counts include requests stopped by verification or daily limits.
      </p>
      {selected && (
        <NetworkDialog
          hash={selected}
          day={day}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}

function NetworkDialog({
  hash,
  day,
  onClose,
  onChanged,
}: {
  hash: string;
  day: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { getToken, role } = useAuth();
  const [data, setData] = useState<NetworkDetails | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(1),
    [reason, setReason] = useState('');
  const sequence = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const seq = ++sequence.current;
      setBusy(true);
      setError(null);
      try {
        const result = await getNetworkDetails(await getToken(), hash, day, cursor);
        if (seq === sequence.current)
          setData((old) => ({
            ...result,
            accounts: {
              ...result.accounts,
              items:
                cursor && old
                  ? [...old.accounts.items, ...result.accounts.items]
                  : result.accounts.items,
            },
          }));
      } catch (err) {
        if (seq === sequence.current) {
          setError((err as Error).message);
          setData(null);
        }
      } finally {
        if (seq === sequence.current) setBusy(false);
      }
    },
    [getToken, hash, day],
  );
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  const blocked = (data?.restriction?.expiresAt ?? 0) > Date.now();
  return (
    <Dialog title="Network details" onClose={onClose}>
      <p style={{ overflowWrap: 'anywhere' }}>{hash}</p>
      <button className="button secondary" disabled={busy} onClick={() => void load()}>
        Refresh
      </button>
      {busy && <p role="status">Loading…</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <h3>{blocked ? 'AI requests blocked' : 'No active network block'}</h3>
          {blocked && (
            <p>
              Until {new Date(data.restriction!.expiresAt).toLocaleString()} ·{' '}
              {data.restriction!.reason}
            </p>
          )}
          <h3>Accounts seen on {day} (UTC)</h3>
          {data.accounts.items.length ? (
            <ul>
              {data.accounts.items.map((account) => (
                <li key={account.uid}>
                  {account.email ?? account.uid} · {account.role} · {account.status}
                </li>
              ))}
            </ul>
          ) : (
            <p>No accounts recorded for this date.</p>
          )}
          {data.accounts.nextCursor && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void load(data.accounts.nextCursor!)}
            >
              More accounts
            </button>
          )}
          {role === 'admin' && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await changeNetworkRestriction(await getToken(), hash, {
                    blocked: !blocked,
                    days,
                    reason,
                    version: data.restriction?.version ?? 0,
                  });
                  setReason('');
                  onChanged();
                  await load();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="notice">
                A network block stops AI requests from every account sharing this IP hash. It does
                not block sign-in or access to saved projects.
              </p>
              <fieldset disabled={busy}>
                {!blocked && (
                  <label className="field">
                    Block duration (days)
                    <input
                      type="number"
                      required
                      min={1}
                      max={365}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                )}
                <label className="field">
                  Reason
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className={`button ${blocked ? 'secondary' : 'danger'}`}
                  disabled={reason.trim().length < 3}
                >
                  {blocked ? 'Confirm unblock' : 'Confirm network block'}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}
