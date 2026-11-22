import { useEffect, useState } from 'react';
import { Loader2, ShieldQuestion, ChevronDown, ClipboardPaste } from 'lucide-react';
import { Modal } from './Modal.jsx';

export function CaptchaModal({ open, url, loading, saving, error, onClose, onSubmitCookie }) {
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!open) {
      setManual(false);
      setValue('');
    }
  }, [open]);

  const showFrame = !loading && !!url && !manual;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Verify write access"
      footer={
        <>
          {!manual && (
            <button type="button" className="btn ghost" onClick={() => setManual(true)}>
              <ClipboardPaste size={14} /> Paste cookie instead
            </button>
          )}
          {manual && url && (
            <button type="button" className="btn ghost" onClick={() => setManual(false)}>
              <ShieldQuestion size={14} /> Use the check instead
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        SoundCloud asks for a quick verification before it allows likes, reposts, comments,
        follows and playlist changes. Solve it once and Wavefront remembers the result for this
        connection.
      </p>

      {showFrame && (
        <div className="captcha-frame-wrap">
          <iframe
            title="SoundCloud verification"
            src={url}
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}

      {loading && (
        <div className="captcha-frame-wrap">
          <div className="captcha-loading">
            <Loader2 size={20} className="spin" />
            <span>Asking SoundCloud for a fresh check…</span>
          </div>
        </div>
      )}

      {manual && (
        <div className="form-grid">
          <label className="field">
            <span className="label">datadome cookie value</span>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="datadome=… or just the value"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={saving || !value.trim()}
            onClick={() => onSubmitCookie(value.trim())}
          >
            {saving ? (
              <>
                <Loader2 size={15} className="spin" /> Checking…
              </>
            ) : (
              'Save and test'
            )}
          </button>
          <details className="info-banner">
            <summary>
              <ShieldQuestion size={14} /> How to get this cookie yourself
              <ChevronDown size={14} className="chev" />
            </summary>
            <div className="info-body">
              <ol className="step-list">
                <li className="step">
                  <span className="num">1</span>
                  <div className="step-body">
                    Switch back with <strong>Use the check instead</strong>. That check is triggered
                    by a request that <strong>cannot</strong> change your account: it asks
                    SoundCloud to add a repost for a track id that does not exist.
                  </div>
                </li>
                <li className="step">
                  <span className="num">2</span>
                  <div className="step-body">Solve the puzzle or audio check in the panel.</div>
                </li>
                <li className="step">
                  <span className="num">3</span>
                  <div className="step-body">
                    If Wavefront does not pick the result up by itself, open DevTools (
                    <strong>F12</strong>) → <strong>Application</strong> → <strong>Cookies</strong>{' '}
                    → <strong>https://soundcloud.com</strong> and copy the value of{' '}
                    <code>datadome</code>.
                  </div>
                </li>
                <li className="step">
                  <span className="num">4</span>
                  <div className="step-body">
                    Paste it above and press <strong>Save and test</strong>. A correct value is
                    accepted straight away.
                  </div>
                </li>
              </ol>
              <p className="hint">
                The value expires after a while. If writes start failing again, repeat these steps.
              </p>
            </div>
          </details>
        </div>
      )}

      {saving && !manual && (
        <p className="hint" style={{ marginTop: 12 }}>
          <Loader2 size={13} className="spin" style={{ verticalAlign: '-2px' }} /> Saving the
          verification…
        </p>
      )}

      {error && (
        <p className="hint error" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
