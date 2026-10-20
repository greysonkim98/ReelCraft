'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetworkActivityResponse } from '@reelcraft/shared';
import { getNetworkActivity } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function NetworkActivity() {
  const { user, loading, getToken } = useAuth();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<NetworkActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
                          <span className={`status-pill ${row.flagged ? 'draft' : 'ready'}`}>
                            {row.flagged
                              ? 'ASN watchlist'
                              : row.lookupStatus === 'ok'
                                ? 'No watchlist match'
                                : row.lookupStatus === 'private'
                                  ? 'Local / private'
                                  : 'Lookup unavailable'}
                          </span>
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
    </>
  );
}
