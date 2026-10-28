import { useEffect, useState } from 'react';
import { clearFailed, flushQueue, getFailedOps, getOfflineState, startOfflineSync, subscribeOffline } from '../lib/offline';

export default function SyncStatus() {
  const [state, setState] = useState(getOfflineState);

  useEffect(() => {
    const unsubscribe = subscribeOffline(setState);
    const stop = startOfflineSync();
    return () => { unsubscribe(); stop(); };
  }, []);

  if (state.online && !state.pending && !state.failed) return null;
  const message = !state.online
    ? `Offline - changes are saved on this device${state.pending ? ` (${state.pending} waiting to sync)` : ''}`
    : state.pending ? `Syncing ${state.pending} change${state.pending === 1 ? '' : 's'}...`
    : `${state.failed} change${state.failed === 1 ? '' : 's'} need review`;
  const failedMessages = state.failed ? getFailedOps().map(op => op.message).join('\n') : '';

  return (
    <div role="status" title={failedMessages} style={{ position:'fixed', left:16, bottom:16, zIndex:1000, display:'flex', gap:10, alignItems:'center', maxWidth:'min(560px, 90vw)', padding:'9px 14px', background:state.online ? '#1B2A4A' : '#8a5a00', color:'#fff', borderRadius:6, fontSize:12, fontWeight:700, boxShadow:'0 4px 16px rgba(13,26,50,.3)' }}>
      {message}
      {state.online && !state.pending && state.failed > 0 && <>
        <span style={{ fontWeight:400 }}>{failedMessages.split('\n')[0]}</span>
        <button type="button" onClick={clearFailed} style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,.5)', borderRadius:4, padding:'3px 8px', cursor:'pointer' }}>Dismiss</button>
      </>}
      {state.online && state.pending > 0 && <button type="button" onClick={flushQueue} style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,.5)', borderRadius:4, padding:'3px 8px', cursor:'pointer' }}>Retry</button>}
    </div>
  );
}
