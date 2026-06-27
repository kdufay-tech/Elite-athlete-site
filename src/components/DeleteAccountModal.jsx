import { Capacitor } from '@capacitor/core';
const IS_IOS = Capacitor.getPlatform() === 'ios';

export default function DeleteAccountModal({ deleting, onCancel, onConfirm }) {
  return (
    <div onClick={() => !deleting && onCancel()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1.5rem' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#121110', border: '1px solid rgba(200,60,60,0.3)', borderRadius: 14, maxWidth: 420, width: '100%', padding: '2rem' }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--ivory)', marginBottom: '0.75rem' }}>Delete Account?</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1rem' }}>
          This permanently deletes your account and all your data — profile, journals, workouts, nutrition logs, progress photos, and history. This cannot be undone.
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '1.5rem', padding: '0.7rem', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
          Note: deleting your account does not cancel your subscription. Manage it in your {IS_IOS ? 'Apple ID settings' : 'billing settings'}.
        </div>
        <div style={{ display: 'flex', gap: '0.7rem' }}>
          <button disabled={deleting} onClick={onCancel}
            style={{ flex: 1, padding: '0.8rem', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'var(--ivory)', fontSize: '0.75rem', letterSpacing: '1px', cursor: 'pointer' }}>Cancel</button>
          <button disabled={deleting} onClick={onConfirm}
            style={{ flex: 1, padding: '0.8rem', background: '#c83232', border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px', cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.7 : 1 }}>{deleting ? 'Deleting…' : 'Delete Permanently'}</button>
        </div>
      </div>
    </div>
  );
}
