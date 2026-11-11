import { useState } from 'react';
import { Camera } from 'lucide-react';
import { enqueue, isNetworkError } from '../lib/offline';
import { getActiveEventId } from '../lib/eventScope';
import { MAX_QUERY_PHOTOS, readableError, updateQuery, uploadQueryPhotos } from '../lib/mock';

// Lets staff and operations add photo evidence to an existing query.
export default function EvidenceUploader({ query, photoUrls, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function add(fileList) {
    const files = [...fileList].slice(0, MAX_QUERY_PHOTOS - photoUrls.length);
    if (!files.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const uploaded = await uploadQueryPhotos(files, query.id);
      const next = [...photoUrls, ...uploaded];
      await updateQuery(query.id, { photo_urls: next });
      onAdded(next);
    } catch (uploadError) {
      if (isNetworkError(uploadError)) {
        try {
          await enqueue('query.evidence', { id:query.id, eventId:getActiveEventId(), photos:files });
          setNotice('Evidence saved on this device. It will sync when the connection returns.');
        } catch (queueError) {
          setError(readableError(queueError, 'Could not save this evidence offline. Free some device storage and try again.'));
        }
      } else {
        setError(readableError(uploadError, 'Could not upload the photo. Check your connection and try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (photoUrls.length >= MAX_QUERY_PHOTOS) return <div style={{ fontSize: 11, color: '#687780' }}>Photo limit reached ({MAX_QUERY_PHOTOS}).</div>;
  return (
    <div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: '1px dashed #9fb0b6', borderRadius: 6, background: '#f7fafb', color: '#172746', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
        <Camera size={15} /> {busy ? 'Uploading...' : 'Add photo evidence'}
        <input type="file" accept="image/*" multiple disabled={busy} aria-label="Add photo evidence" onChange={event => { add(event.target.files); event.target.value = ''; }} style={{ display: 'none' }} />
      </label>
      {notice && <div role="status" style={{ marginTop:6, fontSize:12, color:'#17724a' }}>{notice}</div>}
      {error && <div role="alert" style={{ marginTop: 6, fontSize: 12, color: '#C0392B' }}>{error}</div>}
    </div>
  );
}
