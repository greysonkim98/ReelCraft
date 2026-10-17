'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePreviewProjects } from '@/lib/preview-projects';
import { Icon } from './ui/Icon';
export function ProjectDetails() {
  const { projects } = usePreviewProjects();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id') ?? '');
  }, []);
  const project = projects.find((p) => p.id === id);
  if (id === null) return <p className="notice">Opening project…</p>;
  if (!project)
    return (
      <div className="empty-state">
        <Icon name="film" size={40} />
        <h1>Project not found</h1>
        <p>This preview project may have been removed from this browser.</p>
        <Link href="/projects" className="button primary">
          Back to projects
        </Link>
      </div>
    );
  return (
    <>
      <Link className="back-link" href="/projects">
        ← Back to projects
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT PREVIEW</span>
          <h1>{project.title}</h1>
          <p>{project.description}</p>
        </div>
        <span className="status-pill ready">{project.status}</span>
      </div>
      <div className="detail-layout">
        <div className="detail-poster">
          <img src={project.image} alt={`Cover for ${project.title}`} />
          <div>
            <span>REELCRAFT / SAMPLE STORY</span>
            <h2>{project.title}</h2>
          </div>
        </div>
        <div className="detail-info">
          <section className="panel">
            <h2>The story at a glance</h2>
            <dl className="detail-facts">
              <div>
                <dt>Source clips</dt>
                <dd>{project.clips} videos</dd>
              </div>
              <div>
                <dt>Reel length</dt>
                <dd>{project.duration}</dd>
              </div>
              <div>
                <dt>Color look</dt>
                <dd>{project.look}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>Vertical · 9:16</dd>
              </div>
              <div>
                <dt>Last edited</dt>
                <dd>{new Date(project.updated).toLocaleDateString('en-US')}</dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <span className="feature-icon">
              <Icon name="upload" />
            </span>
            <h2>Your clips, on your device</h2>
            <p>
              Saved projects will store your edit plan, never your videos. To restore an edit,
              you’ll re-select the original clips.
            </p>
            <div className="notice">
              This is a sample project. Restoring saved edit plans is planned; start a new reel to
              use your own footage.
            </div>
            <a className="button primary" href="/editor">
              Start a new reel <Icon name="arrow" size={17} />
            </a>
          </section>
        </div>
      </div>
    </>
  );
}
