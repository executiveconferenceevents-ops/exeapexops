import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function PhotoGallery({ urls, size = 72 }) {
  const [resolvedUrls, setResolvedUrls] = useState([]);
  const urlKey = (urls || []).join('|');

  useEffect(() => {
    let cancelled = false;
    async function resolvePhotos() {
      const sourceUrls = urlKey ? urlKey.split('|') : [];
      const next = await Promise.all(sourceUrls.map(async source => {
        if (!source.startsWith('private://')) return { source, url:source };
        if (!supabase) return { source, url:'' };
        const path = source.slice('private://'.length);
        const { data, error } = await supabase.storage.from('query-photos-private').createSignedUrl(path, 300);
        return { source, url:error ? '' : data?.signedUrl || '' };
      }));
      if (!cancelled) setResolvedUrls(next);
    }
    resolvePhotos();
    return () => { cancelled = true; };
  }, [urlKey]);

  if (!urls?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {resolvedUrls.map(({ source, url }) => url ? (
        <a key={source.slice(-80)} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={url} alt="Stand issue" loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid #d6dfdf', display: 'block' }} />
        </a>
      ) : (
        <span key={source.slice(-80)} role="status" style={{ width:size, height:size, display:'grid', placeItems:'center', padding:4, border:'1px solid #d6dfdf', borderRadius:6, color:'#687780', fontSize:10, textAlign:'center' }}>Photo unavailable</span>
      ))}
    </div>
  );
}
