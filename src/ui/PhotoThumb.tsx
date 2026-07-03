/** Resolves a photo id to an object URL and renders it (or a placeholder). */

import { useEffect, useState } from 'react';
import { useTreeService } from '../app/TreeContext';

interface PhotoThumbProps {
  photoId?: string;
  alt: string;
  className?: string;
}

export function PhotoThumb({ photoId, alt, className }: PhotoThumbProps) {
  const service = useTreeService();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!photoId) {
      setUrl(null);
      return;
    }
    service.getAvatarUrl(photoId).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [photoId, service]);

  if (!photoId || !url) {
    return (
      <div className={`photo-thumb placeholder ${className ?? ''}`} aria-hidden>
        <span>🙂</span>
      </div>
    );
  }
  return <img src={url} alt={alt} className={`photo-thumb ${className ?? ''}`} />;
}
