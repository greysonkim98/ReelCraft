'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePreviewProjects, type PreviewProject } from '@/lib/preview-projects';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';

export function Projects() {
  const { projects, update, storageError } = usePreviewProjects();
  const [filter, setFilter] = useState('All projects');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [editing, setEditing] = useState<PreviewProject | null>(null);
  const [deleting, setDeleting] = useState<PreviewProject | null>(null);
  const [title, setTitle] = useState('');
  const [toast, setToast] = useState('');
  const filtered = projects
    .filter(
      (p) =>
        (filter === 'All projects' || p.status === filter) &&
        p.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name' ? a.title.localeCompare(b.title) : b.updated.localeCompare(a.updated),
    );
  function duplicate(project: PreviewProject) {
    update([
      {
        ...project,
        id: crypto.randomUUID(),
        title: `${project.title} (copy)`,
        status: 'Draft',
        updated: new Date().toISOString(),
      },
      ...projects,
    ]);
    setToast('A copy was added to your preview projects.');
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A SPACE FOR YOUR STORIES</span>
          <h1>
            My projects<span className="mint">.</span>
          </h1>
          <p>Big adventures. Everyday moments. Make something of them.</p>
        </div>
        <a href="/editor" className="button primary">
          <Icon name="plus" size={18} /> New reel
        </a>
      </div>
      <section className="studio-banner">
        <img src="/images/alpine-lake.jpg" alt="Mountains reflected in an alpine lake" />
        <div className="studio-banner-shade" />
        <div className="studio-banner-copy">
          <span className="eyebrow">
            <Icon name="sparkles" size={14} /> A LITTLE CREATIVE MOMENTUM
          </span>
          <h2>
            Your next great story
            <br />
            is already in your camera roll.
          </h2>
          <p>Bring the clips. We’ll help you find the magic.</p>
          <a href="/editor" className="button light">
            Let’s make a reel <Icon name="arrow" size={17} />
          </a>
        </div>
        <div className="banner-format">
          <Icon name="film" size={17} />
          <span>9:16 format</span>
          <span className="separator" /> <span>Up to 60 seconds</span>
        </div>
      </section>
      <div className="workspace-stats">
        <div>
          <span className="stat-icon">
            <Icon name="film" />
          </span>
          <div>
            <strong>{projects.length.toString().padStart(2, '0')}</strong>
            <span>Preview projects</span>
          </div>
        </div>
        <div>
          <span className="stat-icon">
            <Icon name="check" />
          </span>
          <div>
            <strong>
              {projects
                .filter((p) => p.status === 'Ready')
                .length.toString()
                .padStart(2, '0')}
            </strong>
            <span>Ready in preview</span>
          </div>
        </div>
        <div>
          <span className="stat-icon">
            <Icon name="shield" />
          </span>
          <div>
            <strong>100% yours</strong>
            <span>Your footage stays on your device</span>
          </div>
        </div>
      </div>
      <section aria-labelledby="projects-heading">
        <div className="section-heading">
          <h2 id="projects-heading">
            Your collection <span className="count-pill">{projects.length}</span>
          </h2>
          <div className="view-toggle" aria-label="Project layout">
            <button
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
              className={view === 'grid' ? 'selected' : ''}
            >
              <Icon name="grid" size={17} />
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={view === 'list' ? 'selected' : ''}
            >
              <Icon name="list" size={17} />
            </button>
          </div>
        </div>
        <div className="collection-toolbar">
          <div className="tabs" aria-label="Filter projects">
            {['All projects', 'Draft', 'Ready'].map((item) => (
              <button
                key={item}
                className={filter === item ? 'selected' : ''}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item === 'Draft' ? 'Drafts' : item === 'Ready' ? 'Ready to share' : item}
              </button>
            ))}
          </div>
          <div className="collection-tools">
            <label className="search-field">
              <Icon name="search" size={17} />
              <input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Sort projects"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Last edited</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>
        <div className={`project-grid ${view === 'list' ? 'project-list' : ''}`}>
          {filtered.map((project) => (
            <article className="project-card" key={project.id}>
              <Link
                className="project-image"
                href={`/projects/details?id=${encodeURIComponent(project.id)}`}
                aria-label={`Open ${project.title}`}
              >
                <img src={project.image} alt="" />
                <span className={`status-pill ${project.status === 'Ready' ? 'ready' : 'draft'}`}>
                  <span />
                  {project.status === 'Ready' ? 'Ready to share' : 'Draft'}
                </span>
                <span className="duration-pill">
                  <Icon name="play" size={11} />
                  {project.duration}
                </span>
                <span className="project-open">
                  <Icon name="arrow" />
                </span>
              </Link>
              <div className="project-card-content">
                <div className="project-title-row">
                  <h3>
                    <Link href={`/projects/details?id=${encodeURIComponent(project.id)}`}>
                      {project.title}
                    </Link>
                  </h3>
                  <button
                    className="icon-button"
                    aria-label={`Rename ${project.title}`}
                    onClick={() => {
                      setEditing(project);
                      setTitle(project.title);
                    }}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                </div>
                <p>
                  {project.clips} clips <span>·</span> {project.look} look <span>·</span> 9:16
                </p>
                <div className="project-card-footer">
                  <span>
                    <Icon name="clock" size={13} />
                    {new Date(project.updated).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`Duplicate ${project.title}`}
                      onClick={() => duplicate(project)}
                    >
                      <Icon name="copy" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${project.title}`}
                      onClick={() => setDeleting(project)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
          {filter === 'All projects' && !search && (
            <a href="/editor" className="new-project-card">
              <span>
                <Icon name="plus" size={26} />
              </span>
              <strong>A new story starts here</strong>
              <p>
                Turn your favorite clips into
                <br />
                your next favorite reel.
              </p>
              <span className="text-link">
                Create a reel <Icon name="arrow" size={15} />
              </span>
            </a>
          )}
        </div>
        {filtered.length === 0 && (
          <div className="empty-state">
            <Icon name="film" size={36} />
            <h3>{search ? 'No stories found' : 'A fresh start for your stories'}</h3>
            <p>
              {search
                ? 'Try a different title or switch to all projects.'
                : 'Create a reel to get started, or explore another filter.'}
            </p>
            <button
              className="button secondary"
              onClick={() => {
                setFilter('All projects');
                setSearch('');
              }}
            >
              Show all projects
            </button>
          </div>
        )}
      </section>
      <div className="preview-note">
        <Icon name="grid" size={16} />
        <p>
          <strong>Workspace preview.</strong> These are sample projects. Rename, duplicate, and
          delete changes stay in this browser; cloud saving and restoring edit plans are not
          connected yet.
        </p>
      </div>
      {storageError && (
        <p role="alert" className="notice error">
          {storageError}
        </p>
      )}
      {toast && (
        <div role="status" className="toast">
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {editing && (
        <Dialog title="Rename project" onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              update(
                projects.map((p) =>
                  p.id === editing.id
                    ? { ...p, title: title.trim(), updated: new Date().toISOString() }
                    : p,
                ),
              );
              setEditing(null);
              setToast('Project name updated in this browser.');
            }}
          >
            <label className="field">
              Project name
              <input
                autoFocus
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="button primary" disabled={!title.trim()}>
                Save name
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleting && (
        <Dialog title="Delete preview project?" onClose={() => setDeleting(null)}>
          <p>
            Remove “{deleting.title}” from this browser’s sample collection? Your original video
            files are unaffected.
          </p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              Keep project
            </button>
            <button
              className="button danger"
              onClick={() => {
                update(projects.filter((p) => p.id !== deleting.id));
                setDeleting(null);
                setToast('Preview project deleted.');
              }}
            >
              Delete project
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
