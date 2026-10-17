'use client';
import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';
type Role = 'user' | 'support' | 'admin';
interface SampleUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'Active' | 'Suspended' | 'Deleted';
  uses: number;
  country: string;
  devices: number;
  until?: string;
  reason?: string;
}
interface AuditEvent {
  id: string;
  action: string;
  target: string;
  reason: string;
  time: string;
}
const initialUsers: SampleUser[] = [
  {
    id: 'creator-01',
    name: 'Alex Morgan',
    email: 'alex@example.test',
    role: 'user',
    status: 'Active',
    uses: 2,
    country: 'United States',
    devices: 2,
  },
  {
    id: 'creator-02',
    name: 'Jamie Chen',
    email: 'jamie@example.test',
    role: 'user',
    status: 'Active',
    uses: 1,
    country: 'Canada',
    devices: 1,
  },
  {
    id: 'creator-03',
    name: 'Sam Rivera',
    email: 'sam@example.test',
    role: 'support',
    status: 'Active',
    uses: 0,
    country: 'United States',
    devices: 1,
  },
  {
    id: 'creator-04',
    name: 'Taylor Park',
    email: 'taylor@example.test',
    role: 'user',
    status: 'Suspended',
    uses: 3,
    country: 'United Kingdom',
    devices: 4,
    reason: 'Unusual request volume (sample)',
    until: 'Preview restriction',
  },
  {
    id: 'creator-05',
    name: 'Jordan Lee',
    email: 'jordan@example.test',
    role: 'admin',
    status: 'Active',
    uses: 1,
    country: 'United States',
    devices: 2,
  },
];
const initialEvents: AuditEvent[] = [
  {
    id: '1',
    action: 'User suspended',
    target: 'Taylor Park',
    reason: 'Unusual request volume (sample)',
    time: 'Sample · 10:42 AM',
  },
  {
    id: '2',
    action: 'Role updated',
    target: 'Sam Rivera',
    reason: 'Assigned to support (sample)',
    time: 'Sample · 9:18 AM',
  },
  {
    id: '3',
    action: 'Limits updated',
    target: 'Daily generation cap',
    reason: 'Capacity review (sample)',
    time: 'Sample · 8:30 AM',
  },
];
interface AdminState {
  role: 'admin' | 'support';
  setRole: (role: 'admin' | 'support') => void;
  users: SampleUser[];
  setUsers: (users: SampleUser[]) => void;
  events: AuditEvent[];
  record: (action: string, target: string, reason: string) => void;
  blocked: string[];
  setBlocked: (ips: string[]) => void;
  limits: Record<string, number>;
  setLimits: (limits: Record<string, number>) => void;
}
const Context = createContext<AdminState | null>(null);
export function AdminPreviewProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<'admin' | 'support'>('admin');
  const [users, setUsers] = useState(initialUsers);
  const [events, setEvents] = useState(initialEvents);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({
    maxClips: 10,
    maxOutputSeconds: 60,
    aiPerUserPerDay: 3,
    globalDailyAiCap: 60,
    ttsDailyLines: 30,
    ipDailyCap: 10,
  });
  function record(action: string, target: string, reason: string) {
    setEvents((prev) => [
      {
        id: crypto.randomUUID(),
        action,
        target,
        reason,
        time: `Preview · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      },
      ...prev,
    ]);
  }
  return (
    <Context.Provider
      value={{
        role,
        setRole,
        users,
        setUsers,
        events,
        record,
        blocked,
        setBlocked,
        limits,
        setLimits,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAdminPreview() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing preview provider');
  return context;
}
export function usePreviewRole() {
  return useContext(Context)?.role ?? 'admin';
}
const titles = {
  overview: [
    'A clear view of your studio',
    'Sample activity, service capacity, and the people behind the stories.',
  ],
  users: ['People & permissions', 'Review sample accounts and explore the support workflow.'],
  ips: ['Network activity', 'A closer look at sample usage patterns across networks.'],
  settings: [
    'Room to create. Limits to protect.',
    'Preview the runtime controls that keep the service available.',
  ],
  audit: [
    'Every action, accounted for',
    'An activity trail for sample account and configuration changes.',
  ],
};

export function AdminPreview({ view }: { view: keyof typeof titles }) {
  const context = useAdminPreview();
  const { role, setRole } = context;
  const restricted = role === 'support' && (view === 'settings' || view === 'audit');
  return (
    <>
      <div className="console-banner">
        <div>
          <Icon name="shield" size={18} />
          <span>
            <strong>Console preview</strong> · Sample data only. Actions affect this preview
            session.
          </span>
        </div>
        <label>
          Preview as
          <select
            aria-label="Preview console role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'support')}
          >
            <option value="admin">Admin</option>
            <option value="support">Support</option>
          </select>
        </label>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REELCRAFT / {role.toUpperCase()}</span>
          <h1>
            {titles[view][0]}
            <span className="mint">.</span>
          </h1>
          <p>{titles[view][1]}</p>
        </div>
      </div>
      {restricted ? (
        <div className="empty-state">
          <Icon name="shield" size={40} />
          <h2>Reserved for admins</h2>
          <p>
            The support role can review usage and manage short suspensions. Runtime limits and the
            audit log require an admin role.
          </p>
          <Link href="/admin/users" className="button primary">
            Go to users & access
          </Link>
        </div>
      ) : view === 'overview' ? (
        <AdminOverview />
      ) : view === 'users' ? (
        <AdminUsers />
      ) : view === 'ips' ? (
        <AdminIps />
      ) : view === 'settings' ? (
        <AdminSettings />
      ) : (
        <AdminAudit />
      )}
    </>
  );
}
function AdminOverview() {
  const { users, events } = useAdminPreview();
  const stats = [
    {
      label: 'Active accounts',
      value: users.filter((u) => u.status === 'Active').length,
      icon: 'users' as const,
    },
    {
      label: 'AI generations',
      value: users.reduce((sum, u) => sum + u.uses, 0),
      icon: 'sparkles' as const,
    },
    {
      label: 'Suspended accounts',
      value: users.filter((u) => u.status === 'Suspended').length,
      icon: 'shield' as const,
    },
    { label: 'Preview events', value: events.length, icon: 'activity' as const },
  ];
  return (
    <>
      <div className="admin-stats">
        {stats.map((stat) => (
          <section key={stat.label} className="panel">
            <div>
              <span>{stat.label}</span>
              <Icon name={stat.icon} />
            </div>
            <strong>{stat.value.toString().padStart(2, '0')}</strong>
            <small>Sample workspace</small>
          </section>
        ))}
      </div>
      <div className="admin-overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Generation activity</h2>
            <span className="count-pill">Sample week</span>
          </div>
          <p>A preview of the daily activity chart.</p>
          <div
            className="bar-chart"
            role="img"
            aria-label="Illustrative weekly generations: Monday 12, Tuesday 19, Wednesday 15, Thursday 28, Friday 35, Saturday 24, Sunday 8"
          >
            {[12, 19, 15, 28, 35, 24, 8].map((value, i) => (
              <div key={i}>
                <span>{value}</span>
                <div style={{ height: `${value * 4}px` }} />
                <small>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <span className="feature-icon">
            <Icon name="shield" />
          </span>
          <h2>A healthy creative space</h2>
          <p>Review account activity, investigate unusual usage, and keep creators making.</p>
          <div className="quick-links">
            <Link href="/admin/users">
              Review user accounts <Icon name="arrow" size={17} />
            </Link>
            <Link href="/admin/ips">
              Explore network activity <Icon name="arrow" size={17} />
            </Link>
          </div>
          <div className="notice">
            Live service health, IP enrichment, and role enforcement will come from the admin API
            when connected.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Recent preview activity</h2>
          <Link className="text-link" href="/admin/audit">
            View audit log <Icon name="arrow" size={16} />
          </Link>
        </div>
        {events.slice(0, 3).map((event) => (
          <div className="activity-row" key={event.id}>
            <span className="stat-icon">
              <Icon name="activity" size={17} />
            </span>
            <div>
              <strong>{event.action}</strong>
              <span>{event.target}</span>
            </div>
            <time>{event.time}</time>
          </div>
        ))}
      </section>
    </>
  );
}
function AdminUsers() {
  const { users, setUsers, role, record } = useAdminPreview();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<'suspend' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(1);
  const current = users.find((u) => u.id === selected);
  function change(patch: Partial<SampleUser>, label: string, note: string) {
    if (!current) return;
    setUsers(users.map((u) => (u.id === current.id ? { ...u, ...patch } : u)));
    record(label, current.name, note);
  }
  return (
    <>
      <div className="table-toolbar">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            aria-label="Search users"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter user status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {['All statuses', 'Active', 'Suspended', 'Deleted'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Role</th>
              <th>Status</th>
              <th>AI runs today</th>
              <th>Location</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users
              .filter(
                (u) =>
                  `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()) &&
                  (filter === 'All statuses' || u.status === filter),
              )
              .map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="table-person">
                      <span className="avatar">
                        {u.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </span>
                      <div>
                        <strong>{u.name}</strong>
                        <span>{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="role-pill">{u.role}</span>
                  </td>
                  <td>
                    <span className={`status-pill ${u.status === 'Active' ? 'ready' : 'draft'}`}>
                      <span />
                      {u.status}
                    </span>
                  </td>
                  <td>{u.uses}</td>
                  <td>{u.country}</td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => {
                        setSelected(u.id);
                        setAction(null);
                      }}
                    >
                      View <Icon name="arrow" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!users.some(
          (u) =>
            `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()) &&
            (filter === 'All statuses' || u.status === filter),
        ) && (
          <div className="empty-state">
            <h3>No matching accounts</h3>
            <p>Try another search or status.</p>
          </div>
        )}
      </div>
      <p className="fine-print">
        All names, emails, and activity shown here are fictional preview data.
      </p>
      {current && (
        <Dialog title={current.name} onClose={() => setSelected(null)}>
          <p>{current.email} · Sample account</p>
          <dl className="detail-facts">
            <div>
              <dt>Status</dt>
              <dd>{current.status}</dd>
            </div>
            <div>
              <dt>AI runs today</dt>
              <dd>{current.uses}</dd>
            </div>
            <div>
              <dt>Devices</dt>
              <dd>{current.devices}</dd>
            </div>
            {current.reason && (
              <div>
                <dt>Reason</dt>
                <dd>{current.reason}</dd>
              </div>
            )}
            {current.until && (
              <div>
                <dt>Restriction ends</dt>
                <dd>{current.until}</dd>
              </div>
            )}
          </dl>
          {current.status !== 'Deleted' && (
            <>
              <label className="field">
                Account role
                <select
                  value={current.role}
                  disabled={role !== 'admin'}
                  onChange={(e) =>
                    change(
                      { role: e.target.value as Role },
                      'Role updated',
                      `Changed to ${e.target.value} in preview`,
                    )
                  }
                >
                  <option value="user">User</option>
                  <option value="support">Support</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {action === 'suspend' ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reason.trim() || days < 1 || days > (role === 'support' ? 7 : 365)) return;
                    change(
                      {
                        status: 'Suspended',
                        reason: reason.trim(),
                        until: new Date(Date.now() + days * 86400000).toLocaleDateString('en-US'),
                      },
                      'User suspended',
                      reason.trim(),
                    );
                    setAction(null);
                  }}
                >
                  <label className="field">
                    Duration in days
                    <input
                      type="number"
                      min={1}
                      max={role === 'support' ? 7 : 365}
                      required
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    Reason
                    <textarea
                      required
                      maxLength={200}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Explain the restriction…"
                    />
                  </label>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setAction(null)}
                    >
                      Cancel
                    </button>
                    <button className="button danger" disabled={!reason.trim()}>
                      Apply preview suspension
                    </button>
                  </div>
                </form>
              ) : action === 'delete' && role === 'admin' ? (
                <div>
                  <p className="notice">
                    Mark this sample account as deleted? No real account will be affected.
                  </p>
                  <div className="dialog-actions">
                    <button className="button secondary" onClick={() => setAction(null)}>
                      Cancel
                    </button>
                    <button
                      className="button danger"
                      onClick={() => {
                        change({ status: 'Deleted' }, 'Account soft-deleted', 'Preview action');
                        setAction(null);
                      }}
                    >
                      Delete sample account
                    </button>
                  </div>
                </div>
              ) : (
                <div className="dialog-actions">
                  {current.status === 'Suspended' ? (
                    <button
                      className="button secondary"
                      onClick={() =>
                        change(
                          { status: 'Active', reason: undefined, until: undefined },
                          'Suspension lifted',
                          'Preview action',
                        )
                      }
                    >
                      Lift suspension
                    </button>
                  ) : (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setAction('suspend');
                        setReason('');
                        setDays(1);
                      }}
                    >
                      Suspend
                    </button>
                  )}
                  {role === 'admin' && (
                    <button className="button danger" onClick={() => setAction('delete')}>
                      Delete account
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <p className="fine-print">
            {role === 'support'
              ? 'Support can apply suspensions for up to 7 days. Role changes and deletion require admin.'
              : 'Changes apply to the preview session only.'}
          </p>
        </Dialog>
      )}
    </>
  );
}
const sampleIps = [
  {
    hash: 'ip_demo_a81f',
    country: 'United States',
    network: 'Residential network',
    accounts: 2,
    requests: 4,
    flagged: false,
  },
  {
    hash: 'ip_demo_b72c',
    country: 'United Kingdom',
    network: 'Datacenter network',
    accounts: 6,
    requests: 18,
    flagged: true,
  },
  {
    hash: 'ip_demo_c93e',
    country: 'Canada',
    network: 'Residential network',
    accounts: 1,
    requests: 1,
    flagged: false,
  },
];
function AdminIps() {
  const { role, blocked, setBlocked, record } = useAdminPreview();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="table-toolbar">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            aria-label="Search network activity"
            placeholder="Search country or IP hash…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="muted">Hashed identifiers only</span>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>IP hash / country</th>
              <th>Network type</th>
              <th>Accounts</th>
              <th>Requests</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sampleIps
              .filter((ip) =>
                `${ip.hash} ${ip.country}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((ip) => (
                <tr key={ip.hash}>
                  <td>
                    <strong>{ip.hash}</strong>
                    <small>{ip.country}</small>
                  </td>
                  <td>{ip.network}</td>
                  <td>{ip.accounts}</td>
                  <td>{ip.requests}</td>
                  <td>
                    <span
                      className={`status-pill ${ip.flagged || blocked.includes(ip.hash) ? 'draft' : 'ready'}`}
                    >
                      {blocked.includes(ip.hash)
                        ? 'Restricted'
                        : ip.flagged
                          ? 'Review suggested'
                          : 'Normal'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="text-link"
                      disabled={role !== 'admin'}
                      onClick={() => {
                        if (blocked.includes(ip.hash)) {
                          setBlocked(blocked.filter((hash) => hash !== ip.hash));
                          record('IP restriction lifted', ip.hash, 'Preview action');
                        } else {
                          setTarget(ip.hash);
                          setReason('');
                          setDays(1);
                        }
                      }}
                    >
                      {blocked.includes(ip.hash) ? 'Lift restriction' : 'Restrict'}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!sampleIps.some((ip) =>
          `${ip.hash} ${ip.country}`.toLowerCase().includes(query.toLowerCase()),
        ) && (
          <div className="empty-state">
            <h3>No matching networks</h3>
            <p>Try a different country or hash.</p>
          </div>
        )}
      </div>
      <div className="preview-note">
        <Icon name="globe" />
        <p>
          Sample country and network data. The planned IPinfo integration will enrich hashed IP
          activity. Support can inspect activity; only admins can restrict a network.
        </p>
      </div>
      {target && (
        <Dialog title="Restrict sample network" onClose={() => setTarget(null)}>
          <p>{target}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (role !== 'admin' || !reason.trim() || days < 1 || days > 30) return;
              setBlocked([...blocked, target]);
              record('IP restricted', target, `${days} day(s): ${reason.trim()}`);
              setTarget(null);
            }}
          >
            <label className="field">
              Duration in days
              <input
                type="number"
                min={1}
                max={30}
                required
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <label className="field">
              Reason
              <textarea
                required
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setTarget(null)}>
                Cancel
              </button>
              <button className="button danger" disabled={!reason.trim()}>
                Apply preview restriction
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
function AdminSettings() {
  const { limits, setLimits, record } = useAdminPreview();
  const [draft, setDraft] = useState(limits);
  const [saved, setSaved] = useState(false);
  const fields = [
    { key: 'maxClips', label: 'Clips per project', copy: 'Maximum number of source clips.' },
    {
      key: 'maxOutputSeconds',
      label: 'Reel length (seconds)',
      copy: 'Maximum length of a finished reel.',
    },
    {
      key: 'aiPerUserPerDay',
      label: 'AI runs per account / day',
      copy: 'Daily caption generation allowance.',
    },
    {
      key: 'globalDailyAiCap',
      label: 'Service-wide AI runs / day',
      copy: 'Keep generation within service capacity.',
    },
    {
      key: 'ttsDailyLines',
      label: 'Narration lines / day',
      copy: 'Planned allowance for voice generation.',
    },
    {
      key: 'ipDailyCap',
      label: 'AI runs per IP / day',
      copy: 'Use 0 to disable this preview limit.',
    },
  ];
  return (
    <form
      className="panel limits-form"
      onSubmit={(e) => {
        e.preventDefault();
        setLimits({ ...draft });
        record('Limits updated', 'Runtime settings', 'Preview configuration saved');
        setSaved(true);
      }}
    >
      <h2>Generation & project limits</h2>
      <p>These values are illustrative and do not change the editor or backend configuration.</p>
      {fields.map((field) => (
        <label className="limit-row" key={field.key}>
          <span>
            <strong>{field.label}</strong>
            <small>{field.copy}</small>
          </span>
          <input
            type="number"
            min={field.key === 'ipDailyCap' ? 0 : 1}
            max={10000}
            required
            value={draft[field.key]}
            onChange={(e) => {
              setDraft({ ...draft, [field.key]: Number(e.target.value) });
              setSaved(false);
            }}
          />
        </label>
      ))}
      <div className="dialog-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setDraft(limits);
            setSaved(false);
          }}
        >
          Reset changes
        </button>
        <button className="button primary">Save preview settings</button>
      </div>
      {saved && (
        <p role="status" className="notice">
          Settings saved for this preview session. Live limits are unchanged.
        </p>
      )}
    </form>
  );
}
function AdminAudit() {
  const { events } = useAdminPreview();
  const [search, setSearch] = useState('');
  const matches = events.filter((event) =>
    `${event.action} ${event.target} ${event.reason}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="table-toolbar">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            aria-label="Search audit log"
            placeholder="Search actions, people, or reasons…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">{matches.length} events</span>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.action}</strong>
                  <small>Preview operator</small>
                </td>
                <td>{event.target}</td>
                <td>{event.reason}</td>
                <td>{event.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!matches.length && (
          <div className="empty-state">
            <h3>No matching events</h3>
            <p>Try another action or target.</p>
          </div>
        )}
      </div>
    </>
  );
}
