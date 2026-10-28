export default function PhotoGallery({ urls, size = 72 }) {
  if (!urls?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {urls.map(url => (
        <a key={url.slice(-80)} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={url} alt="Stand issue" loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid #d6dfdf', display: 'block' }} />
        </a>
      ))}
    </div>
  );
}
