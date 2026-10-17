'use client';
import { useCallback, useEffect, useState } from 'react';
export interface PreviewProject {
  id: string;
  title: string;
  description: string;
  image: string;
  status: 'Draft' | 'Ready';
  clips: number;
  duration: string;
  look: string;
  updated: string;
}
export const SAMPLE_PROJECTS: PreviewProject[] = [
  {
    id: 'alpine-escape',
    title: 'A little alpine escape',
    description: 'Fresh air, quiet mornings, and taking the long way home.',
    image: '/images/alpine-lake.jpg',
    status: 'Ready',
    clips: 6,
    duration: '0:32',
    look: 'Film',
    updated: '2026-10-16T09:30:00',
  },
  {
    id: 'coastal-days',
    title: 'Coastal state of mind',
    description: 'Salt in the air. Nowhere else to be.',
    image: '/images/ocean.jpg',
    status: 'Draft',
    clips: 8,
    duration: '0:45',
    look: 'Natural',
    updated: '2026-10-15T16:00:00',
  },
  {
    id: 'after-hours',
    title: 'Meet me after sunset',
    description: 'The kind of night you wish would last a little longer.',
    image: '/images/night-sky.jpg',
    status: 'Draft',
    clips: 4,
    duration: '0:24',
    look: 'Cool',
    updated: '2026-10-14T20:00:00',
  },
];
const KEY = 'reelcraft:ui-preview-projects:v1';
export function usePreviewProjects() {
  const [projects, setProjects] = useState<PreviewProject[]>(SAMPLE_PROJECTS);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (p) =>
              p &&
              typeof p.id === 'string' &&
              typeof p.title === 'string' &&
              typeof p.description === 'string' &&
              typeof p.updated === 'string' &&
              ['Draft', 'Ready'].includes(p.status) &&
              SAMPLE_PROJECTS.some((sample) => sample.image === p.image),
          )
        )
          setProjects(parsed);
      }
    } catch {
      setStorageError(
        'Browser storage is unavailable. Preview changes will last only for this visit.',
      );
    }
  }, []);
  const update = useCallback((next: PreviewProject[]) => {
    setProjects(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      setStorageError('Changes are only in memory because browser storage is unavailable.');
    }
  }, []);
  return { projects, update, storageError };
}
