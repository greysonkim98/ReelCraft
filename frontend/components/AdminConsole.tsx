'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminOverview,
  AdminPage,
  AdminUser,
  AuditEntry,
  Role,
  RuntimeLimits,
  RuntimeSettings,
  UserAction,
} from '@reelcraft/shared';
import { useAuth } from '@/lib/auth';
import {
  changeAdminUser,
  getAdminAudit,
  getAdminOverview,
  getAdminSettings,
  getAdminUsers,
  saveAdminSettings,
} from '@/lib/api';
import { Dialog } from './ui/Dialog';

const date = (value: number | null) => (value ? new Date(value).toLocaleString() : '—');
function Feedback({ busy, error }: { busy: boolean; error: string | null }) {
  return (
    <>
      {busy && <p role="status">Loading…</p>}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </>
  );
}
function useResource<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await fetcher();
      if (seq === sequence.current) setData(result);
    } catch (err) {
      if (seq === sequence.current) {
        setData(null);
        setError((err as Error).message);
      }
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }, [fetcher]);
  useEffect(() => {
    setData(null);
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  return { data, busy, error, reload };
}
function usePages<T>(fetcher: (cursor?: string) => Promise<AdminPage<T>>) {
  const [data, setData] = useState<AdminPage<T>>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const seq = ++sequence.current;
      setBusy(true);
      setError(null);
      try {
        const result = await fetcher(cursor);
        if (seq === sequence.current)
          setData((old) => ({
            ...result,
            items: cursor ? [...old.items, ...result.items] : result.items,
          }));
      } catch (err) {
        if (seq === sequence.current) {
          setError((err as Error).message);
          setData({ items: [], nextCursor: null });
        }
      } finally {
        if (seq === sequence.current) setBusy(false);
      }
    },
    [fetcher],
  );
  useEffect(() => {
    setData({ items: [], nextCursor: null });
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  return {
    ...data,
    busy,
    error,
    reload: () => load(),
    more: () => load(data.nextCursor ?? undefined),
  };
}
const titles = {
  overview: ['Studio overview', 'Account status and daily AI usage across ReelCraft.'],
  users: ['People & permissions', 'Manage access, roles, and account restrictions.'],
  settings: [
    'Runtime limits',
    'Control AI capacity and project limits. Changes apply to new requests.',
  ],
  audit: ['Audit log', 'A permanent record of account, network, and configuration changes.'],
};
export function AdminConsole({ view }: { view: keyof typeof titles }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REELCRAFT / MANAGEMENT</span>
          <h1>
            {titles[view][0]}
            <span className="mint">.</span>
          </h1>
          <p>{titles[view][1]}</p>
        </div>
      </div>
      {view === 'overview' ? (
        <Overview />
      ) : view === 'users' ? (
        <Users />
      ) : view === 'settings' ? (
        <Settings />
      ) : (
        <Audit />
      )}
    </>
  );
}
function Overview() {
  const { getToken, user, role } = useAuth();
  const fetcher = useCallback(async () => getAdminOverview(await getToken()), [getToken, user]);
  const { data, busy, error, reload } = useResource<AdminOverview>(fetcher);
  return (
    <>
      <button className="button secondary" disabled={busy} onClick={() => void reload()}>
        Refresh
      </button>
      <Feedback busy={busy} error={error} />
      {data && (
        <>
          <div className="admin-stats">
            {[
              ['Active accounts', data.activeAccounts],
              ['Suspended accounts', data.suspendedAccounts],
              ['Deactivated accounts', data.deletedAccounts],
              ['AI uses today (UTC)', data.week.at(-1)?.used ?? 0],
            ].map(([label, value]) => (
              <section className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <div className="admin-overview-grid">
            <section className="panel">
              <h2>AI usage — last seven UTC days</h2>
              <div
                className="bar-chart"
                role="img"
                aria-label={data.week.map((day) => `${day.day}: ${day.used} uses`).join(', ')}
              >
                {data.week.map((day) => (
                  <div key={day.day}>
                    <span>{day.used}</span>
                    <div
                      style={{
                        height: `${Math.max(2, (day.used / Math.max(1, ...data.week.map((item) => item.used))) * 150)}px`,
                      }}
                    />
                    <small>{day.day.slice(5)}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2>Current capacity</h2>
              <p>{data.settings.limits.aiPerUserPerDay} AI uses per account per UTC day.</p>
              <p>{data.settings.limits.globalDailyAiCap} AI uses service-wide per UTC day.</p>
              <div className="quick-links">
                <Link href="/admin/users">Manage users →</Link>
                <Link href="/admin/ips">Review network activity →</Link>
                {role === 'admin' && <Link href="/admin/settings">Update runtime limits →</Link>}
              </div>
            </section>
          </div>
          {role === 'admin' && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Recent management actions</h2>
                <Link href="/admin/audit">View audit log →</Link>
              </div>
              {data.recentAudit.length ? (
                data.recentAudit.map((event) => (
                  <div className="activity-row" key={event.id}>
                    <div>
                      <strong>{event.action}</strong>
                      <span>{event.target}</span>
                    </div>
                    <time>{date(event.createdAt)}</time>
                  </div>
                ))
              ) : (
                <p>No management actions recorded yet.</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
function Users() {
  const { getToken, user, role } = useAuth();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const fetcher = useCallback(
    async (cursor?: string) => getAdminUsers(await getToken(), search, status, cursor),
    [getToken, user, search, status],
  );
  const page = usePages(fetcher);
  return (
    <>
      <form
        className="table-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchDraft);
        }}
      >
        <input
          aria-label="Search accounts"
          placeholder="Name, email, or UID"
          maxLength={200}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
        <button className="button secondary">Search</button>
        <select
          aria-label="Account status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {['active', 'suspended', 'deleted'].map((item) => (
            <option value={item} key={item}>
              {item === 'deleted' ? 'Deactivated' : item}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button secondary"
          disabled={page.busy}
          onClick={() => void page.reload()}
        >
          Refresh
        </button>
      </form>
      <Feedback busy={page.busy} error={page.error} />
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Status</th>
              <th>AI uses today</th>
              <th>Last sign-in</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((account) => (
              <tr key={account.uid}>
                <td>
                  <strong>{account.name ?? account.email ?? account.uid}</strong>
                  <small>{account.email}</small>
                  <small>{account.uid}</small>
                </td>
                <td>{account.role}</td>
                <td>{account.status === 'deleted' ? 'Deactivated' : account.status}</td>
                <td>{account.aiUsedToday ?? 0}</td>
                <td>{date(account.lastLoginAt)}</td>
                <td>
                  <button className="text-link" onClick={() => setSelected(account)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!page.busy && !page.error && !page.items.length && (
        <p className="empty-state">
          No matching accounts in this page.{' '}
          {page.nextCursor ? 'Load more to continue searching.' : ''}
        </p>
      )}
      {page.nextCursor && (
        <button className="button secondary" disabled={page.busy} onClick={() => void page.more()}>
          Load more
        </button>
      )}
      {selected && (
        <UserDialog
          account={selected}
          role={role}
          own={selected.uid === user?.uid}
          onClose={() => setSelected(null)}
          onSaved={(account) => {
            setSelected(account);
            void page.reload();
          }}
        />
      )}
    </>
  );
}
function UserDialog({
  account,
  role,
  own,
  onClose,
  onSaved,
}: {
  account: AdminUser;
  role: Role | null;
  own: boolean;
  onClose: () => void;
  onSaved: (user: AdminUser) => void;
}) {
  const { getToken } = useAuth();
  const [action, setAction] = useState<UserAction['action']>(
    account.status === 'deleted' ? 'restore' : 'suspend',
  );
  const [newRole, setNewRole] = useState<Role>(account.role);
  const [days, setDays] = useState(1),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  const actions: UserAction['action'][] =
    account.status === 'deleted'
      ? ['restore']
      : role === 'admin'
        ? ['suspend', 'unsuspend', 'role', 'delete']
        : ['suspend', 'unsuspend'];
  const labels = {
    suspend: 'Suspend account',
    unsuspend: 'Lift suspension',
    role: 'Change role',
    delete: 'Deactivate account',
    restore: 'Restore as regular user',
  };
  return (
    <Dialog title={account.email ?? account.uid} onClose={onClose}>
      <dl className="detail-facts">
        <div>
          <dt>UID</dt>
          <dd>{account.uid}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{account.role}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{account.status}</dd>
        </div>
        <div>
          <dt>Suspension ends</dt>
          <dd>{date(account.suspendedUntil)}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{account.reason ?? '—'}</dd>
        </div>
      </dl>
      {own ? (
        <p className="notice">Another admin must manage your account.</p>
      ) : role === 'support' && (account.role !== 'user' || account.status === 'deleted') ? (
        <p className="notice">An admin is required to manage this account.</p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setSaved(false);
            try {
              const base = { reason, version: account.version };
              const payload: UserAction =
                action === 'role'
                  ? { ...base, action, role: newRole }
                  : action === 'suspend'
                    ? { ...base, action, days }
                    : { ...base, action };
              const result = await changeAdminUser(await getToken(), account.uid, payload);
              onSaved(result);
              setReason('');
              setAction(result.status === 'deleted' ? 'restore' : 'suspend');
              setSaved(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label className="field">
              Action
              <select
                value={action}
                onChange={(e) => {
                  setAction(e.target.value as UserAction['action']);
                  setSaved(false);
                }}
              >
                {actions.map((item) => (
                  <option value={item} key={item}>
                    {labels[item]}
                  </option>
                ))}
              </select>
            </label>
            {action === 'role' && (
              <label className="field">
                New role
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  {['user', 'support', 'admin'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            )}
            {action === 'suspend' && (
              <label className="field">
                Days
                <input
                  type="number"
                  required
                  min={1}
                  max={role === 'support' ? 7 : 365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
            )}
            {action === 'delete' && (
              <p className="notice">
                This will block the account from ReelCraft immediately. Its Firebase identity and
                project records are retained; an admin can restore access.
              </p>
            )}
            {action === 'restore' && (
              <p className="notice">Restoring clears restrictions and resets the role to user.</p>
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
              className={`button ${action === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? 'Saving…' : `Confirm: ${labels[action]}`}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className="notice">
          {error} Close and reopen this account to refresh it.
        </p>
      )}
      {saved && <p role="status">Change saved and recorded in the audit log.</p>}
    </Dialog>
  );
}
function Settings() {
  const { getToken, user } = useAuth();
  const fetcher = useCallback(async () => getAdminSettings(await getToken()), [getToken, user]);
  const resource = useResource(fetcher);
  return (
    <>
      <button
        className="button secondary"
        disabled={resource.busy}
        onClick={() => void resource.reload()}
      >
        Reload saved settings
      </button>
      <Feedback busy={resource.busy} error={resource.error} />
      {resource.data && (
        <SettingsForm
          key={resource.data.version}
          settings={resource.data}
          reload={resource.reload}
        />
      )}
    </>
  );
}
function SettingsForm({
  settings,
  reload,
}: {
  settings: RuntimeSettings;
  reload: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const [draft, setDraft] = useState(settings.limits),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const fields: {
    key: keyof RuntimeLimits;
    label: string;
    min: number;
    max: number;
    note: string;
  }[] = [
    {
      key: 'aiPerUserPerDay',
      label: 'AI uses per account / UTC day',
      min: 0,
      max: 10000,
      note: '0 pauses AI generation for everyone.',
    },
    {
      key: 'globalDailyAiCap',
      label: 'AI uses service-wide / UTC day',
      min: 0,
      max: 10000,
      note: '0 pauses AI generation. Existing usage counts are retained.',
    },
    {
      key: 'ipDailyCap',
      label: 'AI uses per network / UTC day',
      min: 0,
      max: 10000,
      note: '0 disables this cap. Shared networks count together.',
    },
    {
      key: 'maxClips',
      label: 'Source clips per project',
      min: 1,
      max: 30,
      note: 'Applied by the editor when importing or analyzing clips.',
    },
    {
      key: 'maxOutputSeconds',
      label: 'Reel length in seconds',
      min: 3,
      max: 60,
      note: 'Applied in the editor and checked on AI caption requests.',
    },
  ];
  return (
    <form
      className="panel limits-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await saveAdminSettings(await getToken(), draft, settings.version, reason);
          await reload();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Generation & project limits</h2>
      <p>
        Saved revision {settings.version} ·{' '}
        {settings.updatedAt ? date(settings.updatedAt) : 'Using backend defaults'}
      </p>
      <fieldset disabled={busy}>
        {fields.map((field) => (
          <label className="limit-row" key={field.key}>
            <span>
              <strong>{field.label}</strong>
              <small>{field.note}</small>
            </span>
            <input
              type="number"
              required
              min={field.min}
              max={field.max}
              value={draft[field.key]}
              onChange={(e) => setDraft({ ...draft, [field.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label className="field">
          Reason for change
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setDraft(settings.limits);
              setReason('');
            }}
          >
            Reset changes
          </button>
          <button className="button primary" disabled={reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Save runtime limits'}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </form>
  );
}
function Audit() {
  const { getToken, user } = useAuth();
  const [search, setSearch] = useState('');
  const fetcher = useCallback(
    async (cursor?: string) => getAdminAudit(await getToken(), cursor),
    [getToken, user],
  );
  const page = usePages<AuditEntry>(fetcher);
  const matches = page.items.filter((event) =>
    `${event.action} ${event.target} ${event.reason} ${event.actorEmail} ${event.actorUid}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="table-toolbar">
        <input
          aria-label="Search loaded audit events"
          placeholder="Search loaded events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="button secondary"
          disabled={page.busy}
          onClick={() => void page.reload()}
        >
          Refresh
        </button>
        <span>{page.items.length} events loaded</span>
      </div>
      <Feedback busy={page.busy} error={page.error} />
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Action / operator</th>
              <th>Target</th>
              <th>Reason / changes</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.action}</strong>
                  <small>
                    {event.actorEmail ?? event.actorUid} ({event.actorRole})
                  </small>
                </td>
                <td>{event.target}</td>
                <td>
                  {event.reason}
                  <details>
                    <summary>View changes</summary>
                    <pre
                      style={{ maxWidth: 420, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
                    </pre>
                  </details>
                </td>
                <td>{date(event.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!page.busy && !page.error && !matches.length && (
        <p className="empty-state">No matching audit events loaded.</p>
      )}
      {page.nextCursor && (
        <button className="button secondary" disabled={page.busy} onClick={() => void page.more()}>
          Load more
        </button>
      )}
    </>
  );
}
