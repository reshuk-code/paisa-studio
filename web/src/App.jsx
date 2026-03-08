import { useState, useCallback, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import './App.css'

const ANDROID_APK_URL = 'https://expo.dev/accounts/rs-code/projects/paisa-studio/builds/eeaee809-bc0c-4ee8-9f29-ab7cb99eb381'

// ─── EMV / QR Utils ───────────────────────────────────────────────────────────
function tlv(tag, value) {
  return tag + String(value.length).padStart(2, '0') + value
}
function crc16(str) {
  let crc = 0xffff
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1
      crc &= 0xffff
    }
  }
  return crc
}
function buildEMVQR({ merchantId, name, city, mcc }) {
  const mid = (merchantId || '').trim() || '00000000000000'
  const mai = tlv('00', '11') + tlv('07', mid)
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('26', mai) +
    tlv('52', (mcc || '8299').trim()) + tlv('53', '524') + tlv('58', 'NP') +
    tlv('59', (name || 'Merchant').trim()) + tlv('60', (city || 'Kathmandu').trim()) +
    tlv('62', tlv('07', '0000000')) + '6304'
  return body + crc16(body).toString(16).toUpperCase().padStart(4, '0')
}
function buildESEWAQR(id, name) {
  return JSON.stringify({ eSewa_id: id.trim(), name: name.trim() })
}
function parseEMVQR(raw) {
  try {
    const get = (tag) => {
      const idx = raw.indexOf(tag)
      if (idx < 0) return ''
      const len = parseInt(raw.slice(idx + 2, idx + 4))
      return raw.slice(idx + 4, idx + 4 + len)
    }
    return {
      name: get('59'), city: get('60'), mcc: get('52'),
      merchantId: (() => { const mai = get('26'); return mai ? mai.slice(mai.indexOf('07') + 4) : '' })()
    }
  } catch { return null }
}
function parseESEWAQR(raw) {
  try {
    const data = JSON.parse(raw)
    if (data.eSewa_id || data.name) return { id: data.eSewa_id || '', name: data.name || '' }
    return null
  } catch { return null }
}

// ─── QR Decoder via jsQR ──────────────────────────────────────────────────────
async function decodeQRFromImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height)
        resolve(code ? code.data : null)
      } else { resolve(null) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// ─── QR Canvas ────────────────────────────────────────────────────────────────
const BRAND_LOGO_SRC = '/icon.png'

function QRCanvas({ data, size = 220, fg = '#1a1a1d', bg = '#ffffff', dotStyle = 'round', cornerStyle = 'round', logo = 'none', logoUri = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!data || !canvasRef.current) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1

    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const drawQR = () => {
      try {
        const qr = QRCode.create(data, { errorCorrectionLevel: 'H' })
        const count = qr.modules.size
        const modules = qr.modules.data
        const PAD = 14
        const cell = (size - PAD * 2) / count

        ctx.fillStyle = bg
        ctx.beginPath(); rrect(ctx, 0, 0, size, size, 10); ctx.fill()

        ctx.fillStyle = fg
        for (let r = 0; r < count; r++) {
          for (let c = 0; c < count; c++) {
            if (!modules[r * count + c]) continue
            if (isFinderCell(r, c, count)) continue
            const x = PAD + c * cell
            const y = PAD + r * cell
            const s = cell * 0.82
            const o = (cell - s) / 2
            ctx.beginPath()
            if (dotStyle === 'round') {
              ctx.arc(x + o + s / 2, y + o + s / 2, s / 2, 0, Math.PI * 2)
            } else if (dotStyle === 'diamond') {
              const cx = x + cell / 2, cy = y + cell / 2, h = s / 2
              ctx.moveTo(cx, cy - h); ctx.lineTo(cx + h, cy)
              ctx.lineTo(cx, cy + h); ctx.lineTo(cx - h, cy); ctx.closePath()
            } else {
              rrect(ctx, x + o, y + o, s, s, s * 0.15)
            }
            ctx.fill()
          }
        }

        ;[[0, 0], [0, count - 7], [count - 7, 0]].forEach(([sr, sc]) => {
          const x = PAD + sc * cell
          const y = PAD + sr * cell
          const s7 = cell * 7, s5 = cell * 5, s3 = cell * 3
          const outerR = cornerStyle === 'square' ? 0 : cornerStyle === 'round' ? s7 * 0.18 : s7 * 0.44
          const innerR = Math.max(0, outerR - cell * 0.65)
          const dotR = cornerStyle === 'pill' ? s3 * 0.4 : Math.max(0, outerR * 0.4)
          ctx.fillStyle = fg; ctx.beginPath(); rrect(ctx, x, y, s7, s7, outerR); ctx.fill()
          ctx.fillStyle = bg; ctx.beginPath(); rrect(ctx, x + cell, y + cell, s5, s5, innerR); ctx.fill()
          ctx.fillStyle = fg; ctx.beginPath(); rrect(ctx, x + cell * 2, y + cell * 2, s3, s3, dotR); ctx.fill()
        })
      } catch (err) {
        console.error('QR gen error:', err)
      }
    }

    const drawLogo = (src) => {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          const logoSize = size * 0.22
          const logoX = (size - logoSize) / 2
          const logoY = (size - logoSize) / 2
          const radius = logoSize * 0.22
          ctx.fillStyle = bg
          ctx.beginPath(); rrect(ctx, logoX - 4, logoY - 4, logoSize + 8, logoSize + 8, radius + 3); ctx.fill()
          ctx.save()
          ctx.beginPath(); rrect(ctx, logoX, logoY, logoSize, logoSize, radius); ctx.clip()
          ctx.drawImage(img, logoX, logoY, logoSize, logoSize)
          ctx.restore()
          resolve()
        }
        img.onerror = () => resolve()
        img.crossOrigin = 'anonymous'
        img.src = src
      })
    }

    const render = async () => {
      drawQR()
      if (logo === 'brand') await drawLogo(BRAND_LOGO_SRC)
      else if (logo === 'custom' && logoUri) await drawLogo(logoUri)
    }

    render()
  }, [data, size, fg, bg, dotStyle, cornerStyle, logo, logoUri])

  if (!data) return null
  return <canvas ref={canvasRef} style={{ borderRadius: 8, display: 'block' }} />
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function isFinderCell(r, c, n) {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const QR_PRESETS = [
  { id: 'classic',  label: 'Classic',  fg: '#1a1a1d', bg: '#ffffff' },
  { id: 'gold',     label: 'Gold',     fg: '#c47d0e', bg: '#fffbf0' },
  { id: 'esewa',    label: 'eSewa',    fg: '#1a7a3a', bg: '#f0fdf4' },
  { id: 'forest',   label: 'Forest',   fg: '#f0fdf4', bg: '#1a5c30' },
  { id: 'fonepay',  label: 'FonePay',  fg: '#1a4fd6', bg: '#eff6ff' },
  { id: 'midnight', label: 'Midnight', fg: '#e0e0f0', bg: '#0a0a14' },
  { id: 'plum',     label: 'Plum',     fg: '#6b21a8', bg: '#faf5ff' },
  { id: 'crimson',  label: 'Crimson',  fg: '#9b1c1c', bg: '#fff5f5' },
]

// ─── SVG Icon ─────────────────────────────────────────────────────────────────
function Icon({ name, size = 16, color = 'currentColor', style }) {
  const paths = {
    'wallet-outline':             <><rect x="2" y="7" width="20" height="14" rx="2" stroke={color} strokeWidth="1.6" fill="none"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="16" cy="14" r="1.5" fill={color}/></>,
    'wallet':                     <><rect x="2" y="7" width="20" height="14" rx="2" fill={color} opacity="0.15"/><rect x="2" y="7" width="20" height="14" rx="2" stroke={color} strokeWidth="1.8" fill="none"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" stroke={color} strokeWidth="1.8" fill="none"/><circle cx="16" cy="14" r="2" fill={color}/></>,
    'phone-portrait-outline':     <><rect x="7" y="2" width="10" height="20" rx="2" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="12" cy="18.5" r="1" stroke={color} strokeWidth="1" fill="none"/></>,
    'phone-portrait':             <><rect x="7" y="2" width="10" height="20" rx="2" fill={color} opacity="0.15"/><rect x="7" y="2" width="10" height="20" rx="2" stroke={color} strokeWidth="1.8" fill="none"/><circle cx="12" cy="18.5" r="1" fill={color}/></>,
    'scan-outline':               <><path d="M4 7V5a2 2 0 0 1 2-2h2M15 3h2a2 2 0 0 1 2 2v2M4 17v2a2 2 0 0 0 2 2h2M15 21h2a2 2 0 0 0 2-2v-2" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/><rect x="8" y="8" width="8" height="8" rx="1" stroke={color} strokeWidth="1.5" fill="none"/></>,
    'storefront-outline':         <><path d="M3 9l1-5h16l1 5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><path d="M3 9v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" stroke={color} strokeWidth="1.6" fill="none"/><path d="M9 9a3 3 0 0 0 6 0" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 9a3 3 0 0 0 6 0" stroke={color} strokeWidth="1.6" fill="none"/><path d="M15 9a3 3 0 0 0 6 0" stroke={color} strokeWidth="1.6" fill="none"/><rect x="9" y="14" width="6" height="6" rx="0.5" stroke={color} strokeWidth="1.4" fill="none"/></>,
    'barcode-outline':            <><rect x="3" y="4" width="1.5" height="16" fill={color}/><rect x="6.5" y="4" width="1" height="16" fill={color}/><rect x="9.5" y="4" width="2" height="16" fill={color}/><rect x="13.5" y="4" width="1" height="16" fill={color}/><rect x="16.5" y="4" width="1.5" height="16" fill={color}/><rect x="19.5" y="4" width="1" height="16" fill={color}/></>,
    'location-outline':           <><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="12" cy="9" r="2.5" stroke={color} strokeWidth="1.4" fill="none"/></>,
    'color-palette-outline':      <><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="9" cy="9" r="1.5" fill={color}/><circle cx="15" cy="9" r="1.5" fill={color}/><circle cx="9" cy="15" r="1.5" fill={color}/><circle cx="15" cy="15" r="1.5" fill={color}/></>,
    'information-circle-outline': <><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" fill="none"/><line x1="12" y1="10" x2="12" y2="16" stroke={color} strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="7.5" r="1" fill={color}/></>,
    'cloud-upload-outline':       <><polyline points="16 16 12 12 8 16" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="12" x2="12" y2="21" stroke={color} strokeWidth="1.8" strokeLinecap="round"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/></>,
    'download-outline':           <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/><polyline points="7 10 12 15 17 10" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></>,
    'share-outline':              <><circle cx="18" cy="5" r="3" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="6" cy="12" r="3" stroke={color} strokeWidth="1.6" fill="none"/><circle cx="18" cy="19" r="3" stroke={color} strokeWidth="1.6" fill="none"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke={color} strokeWidth="1.6"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke={color} strokeWidth="1.6"/></>,
    'person-outline':             <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><circle cx="12" cy="7" r="4" stroke={color} strokeWidth="1.6" fill="none"/></>,
    'call-outline':               <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 .32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8A16 16 0 0 0 13 13.91l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 15l.07.16A2 2 0 0 1 22 16.92z" stroke={color} strokeWidth="1.6" fill="none"/></>,
    'close-outline':              <><line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></>,
    'checkmark-circle-outline':   <><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" fill="none"/><polyline points="9 12 11 14 15 10" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></>,
    'android':                    <><path d="M6 18V10h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill={color} opacity="0.15" stroke={color} strokeWidth="1.5"/><path d="M6 10a6 6 0 0 1 12 0" stroke={color} strokeWidth="1.5" fill="none"/><line x1="9" y1="6.5" x2="7.5" y2="4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/><line x1="15" y1="6.5" x2="16.5" y2="4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/><circle cx="9.5" cy="8.5" r="0.8" fill={color}/><circle cx="14.5" cy="8.5" r="0.8" fill={color}/><line x1="4" y1="10" x2="4" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round"/><line x1="20" y1="10" x2="20" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round"/></>,
    'close-circle':               <><circle cx="12" cy="12" r="9" fill={color} opacity="0.15"/><line x1="15" y1="9" x2="9" y2="15" stroke={color} strokeWidth="1.8" strokeLinecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      {paths[name] || null}
    </svg>
  )
}

// ─── Android App Banner ───────────────────────────────────────────────────────
function AndroidAppBanner() {
  const [dismissed, setDismissed] = useState(false)
  const isAndroid = /android/i.test(navigator.userAgent)
  const isMobile = /mobi|android/i.test(navigator.userAgent)
  if (!isAndroid || !isMobile || dismissed) return null
  return (
    <div className="android-banner">
      <div className="android-banner-left">
        <img src="/icon.png" alt="Paisa Studio" className="android-banner-icon" />
        <div className="android-banner-text">
          <span className="android-banner-title">Paisa Studio</span>
          <span className="android-banner-sub">Get the full app — scan, save &amp; more</span>
        </div>
      </div>
      <div className="android-banner-actions">
        <a href={ANDROID_APK_URL} className="android-banner-btn" target="_blank" rel="noopener noreferrer">
          <Icon name="android" size={14} color="#0f0f10" />
          Download
        </a>
        <button className="android-banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <Icon name="close-circle" size={20} color="var(--text3)" />
        </button>
      </div>
    </div>
  )
}

// ─── Wordmark ─────────────────────────────────────────────────────────────────
function PaisaWordmark() {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="wordmark">
      {!imgFailed ? (
        <img src="/icon.png" width="28" height="28" alt="" className="wordmark-img" onError={() => setImgFailed(true)} />
      ) : (
        <svg width="28" height="28" viewBox="0 0 32 32">
          <defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbbf24" /><stop offset="1" stopColor="#d97706" /></linearGradient></defs>
          <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#wg)" />
          <rect x="8" y="8" width="3.5" height="16" rx="1.75" fill="#0f0f10" />
          <rect x="8" y="8" width="12" height="3.5" rx="1.75" fill="#0f0f10" />
          <rect x="8" y="14.5" width="10" height="3" rx="1.5" fill="#0f0f10" />
          <path d="M11.5 8 Q22 8 22 13.5 Q22 18 11.5 18" fill="none" stroke="#0f0f10" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M13 18 L20 24" stroke="#0f0f10" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      <span className="wordmark-text">Paisa <span className="wordmark-accent">Studio</span></span>
    </div>
  )
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ label, iconName, value, onChange, placeholder, type = 'text', maxLength, note, accentColor }) {
  const [focused, setFocused] = useState(false)
  return (
    <div className="field">
      <label className="field-label">{label}{note && <span className="field-note"> · {note}</span>}</label>
      <div className="field-wrap" style={focused && accentColor ? { borderColor: accentColor + '55' } : {}}>
        <span className="field-icon"><Icon name={iconName} size={15} color={focused && accentColor ? accentColor : 'var(--text3)'} /></span>
        <input className="field-input" type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} maxLength={maxLength}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      </div>
    </div>
  )
}

// ─── Upload Drop Zone ─────────────────────────────────────────────────────────
function UploadDropZone({ onQRDetected, accentColor }) {
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null)
  const fileRef = useRef(null)
  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) { setStatus('error'); setTimeout(() => setStatus(null), 2000); return }
    setStatus('scanning')
    const result = await decodeQRFromImage(file)
    if (result) { onQRDetected(result); setStatus('success'); setTimeout(() => setStatus(null), 2000) }
    else { setStatus('error'); setTimeout(() => setStatus(null), 2500) }
  }, [onQRDetected])
  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }, [handleFile])
  const statusColor = status === 'success' ? 'var(--esewa)' : status === 'error' ? '#f04438' : accentColor
  return (
    <div className={`upload-zone${dragging ? ' upload-zone-drag' : ''}`}
      style={dragging ? { borderColor: accentColor, background: accentColor + '0a' } : {}}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragEnter={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => fileRef.current?.click()}>
      <input ref={fileRef} type="file" accept="image/*" onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }} style={{ display: 'none' }} />
      {status ? (
        <div className="upload-status">
          {status === 'scanning' && <div className="upload-spinner" style={{ borderColor: accentColor + '30', borderTopColor: accentColor }} />}
          {status === 'success' && <Icon name="checkmark-circle-outline" size={20} color={statusColor} />}
          {status === 'error' && <Icon name="close-outline" size={20} color={statusColor} />}
          <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>
            {status === 'scanning' ? 'Scanning…' : status === 'success' ? 'QR detected!' : 'No QR found'}
          </span>
        </div>
      ) : (
        <div className="upload-content">
          <Icon name="cloud-upload-outline" size={20} color={accentColor} style={{ opacity: 0.65 }} />
          <div className="upload-text">
            <span className="upload-title">Upload or drop a QR image</span>
            <span className="upload-hint">PNG, JPG · auto-fills fields from existing QRs</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── QR Preview Card ──────────────────────────────────────────────────────────
function QRPreviewCard({ data, name, tagLabel, tagColor, tagBg, tagBorder, qrFg, qrBg, dotStyle, cornerStyle, logo, logoUri, onDownload }) {
  const hasData = Boolean(data)
  return (
    <div className="qr-card">
      <div className="qr-card-header">
        <div className="tag-pill" style={{ background: tagBg, borderColor: tagBorder }}>
          <div className="tag-dot" style={{ background: tagColor }} />
          <span style={{ color: tagColor, fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>{tagLabel}</span>
        </div>
        {hasData && name ? <span className="qr-name">{name}</span> : <span className="qr-placeholder">Fill in details →</span>}
      </div>
      <div className="qr-preview-area">
        {hasData ? (
          <div className="qr-display" style={{ background: qrBg }} id="qr-display-wrap">
            <QRCanvas data={data} size={220} fg={qrFg} bg={qrBg} dotStyle={dotStyle} cornerStyle={cornerStyle} logo={logo || 'none'} logoUri={logoUri || ''} />
          </div>
        ) : (
          <div className="qr-empty">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.18">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="3" height="3" />
              <rect x="18" y="18" width="3" height="3" /><rect x="14" y="18" width="3" height="3" /><rect x="18" y="14" width="3" height="3" />
            </svg>
            <span className="qr-empty-title">No QR yet</span>
            <span className="qr-empty-hint">Enter details below</span>
          </div>
        )}
      </div>
      <div className="qr-stamp"><div className="stamp-dot" /><span>Paisa Studio</span></div>
      <div className="qr-actions">
        <button className="btn-save" disabled={!hasData} onClick={onDownload}>
          <Icon name="download-outline" size={14} color={hasData ? '#0f0f10' : 'var(--text3)'} />Save QR
        </button>
        <button className="btn-share" disabled={!hasData} onClick={onDownload}>
          <Icon name="share-outline" size={14} color="var(--text2)" />Share
        </button>
      </div>
    </div>
  )
}

// ─── Style Panel ──────────────────────────────────────────────────────────────
function StylePanel({ fg, bg, dotStyle, cornerStyle, logo, logoUri, onFg, onBg, onDotStyle, onCornerStyle, onLogo, onLogoUri, accentColor }) {
  const fileRef = useRef(null)
  const handleLogoChange = (v) => { onLogo(v); if (v === 'custom') fileRef.current?.click() }
  const handleFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return
    onLogoUri(URL.createObjectURL(file)); onLogo('custom'); e.target.value = ''
  }
  return (
    <div className="style-panel">
      <div className="style-section">
        <span className="style-label">Dot Shape</span>
        <div className="seg-control">
          {[['square', '▪ Square'], ['round', '● Circle'], ['diamond', '◆ Diamond']].map(([v, l]) => (
            <button key={v} className={`seg-btn${dotStyle === v ? ' seg-active' : ''}`}
              style={dotStyle === v ? { color: accentColor, borderColor: accentColor + '50', background: accentColor + '15' } : {}}
              onClick={() => onDotStyle(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="style-section">
        <span className="style-label">Corner Style</span>
        <div className="seg-control">
          {[['square', 'Sharp'], ['round', 'Rounded'], ['pill', 'Pill']].map(([v, l]) => (
            <button key={v} className={`seg-btn${cornerStyle === v ? ' seg-active' : ''}`}
              style={cornerStyle === v ? { color: accentColor, borderColor: accentColor + '50', background: accentColor + '15' } : {}}
              onClick={() => onCornerStyle(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="style-section">
        <span className="style-label">Presets</span>
        <div className="presets-row">
          {QR_PRESETS.map(p => {
            const active = p.fg === fg && p.bg === bg
            return (
              <button key={p.id} className={`preset-chip${active ? ' preset-active' : ''}`} onClick={() => { onFg(p.fg); onBg(p.bg) }}>
                <div className="preset-swatch"><div style={{ flex: 1, background: p.fg }} /><div style={{ flex: 1, background: p.bg }} /></div>
                <span>{p.label}</span>{active && <span className="preset-tick">✓</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="style-section">
        <span className="style-label">Colors</span>
        <div className="color-row">
          {[[fg, 'Dots', onFg, 'dots'], [bg, 'Background', onBg, 'bg']].map(([color, label, handler, key]) => (
            <label key={key} className="color-card">
              <div className="color-dot" style={{ background: color }} />
              <div className="color-info"><span className="color-label">{label}</span><span className="color-hex">{color.toUpperCase()}</span></div>
              <input type="color" value={color} onChange={e => handler(e.target.value)} className="color-input" />
              <span className="color-edit-btn">Edit</span>
            </label>
          ))}
        </div>
      </div>
      <div className="style-section">
        <span className="style-label">Center Logo</span>
        <div className="seg-control">
          {[['none', '✕ None'], ['brand', '★ Brand'], ['custom', '⬆ Custom']].map(([v, l]) => (
            <button key={v} className={`seg-btn${logo === v ? ' seg-active' : ''}`}
              style={logo === v ? { color: 'var(--accent)', borderColor: 'var(--accent-border)', background: 'var(--accent-light)' } : {}}
              onClick={() => handleLogoChange(v)}>{l}</button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        {logo === 'brand' && (
          <div className="logo-preview-row">
            <img src="/icon.png" alt="brand" className="logo-preview-img" />
            <div className="logo-preview-info"><span className="logo-preview-name">Paisa Studio Brand</span><span className="logo-preview-sub">Centered in your QR</span></div>
            <span className="logo-preview-check">✓</span>
          </div>
        )}
        {logo === 'custom' && logoUri && (
          <div className="logo-preview-row logo-preview-row-btn" onClick={() => fileRef.current?.click()}>
            <img src={logoUri} alt="custom" className="logo-preview-img" />
            <div className="logo-preview-info"><span className="logo-preview-name">Custom Logo</span><span className="logo-preview-sub" style={{ color: 'var(--accent)' }}>Click to change</span></div>
            <span className="logo-preview-arrow">›</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('esewa')
  const [esewaId, setEsewaId] = useState('')
  const [esewaName, setEsewaName] = useState('')
  const [fpName, setFpName] = useState('')
  const [fpMerchantId, setFpMerchantId] = useState('')
  const [fpCity, setFpCity] = useState('Kathmandu')
  const [fpMcc, setFpMcc] = useState('8299')
  const [fg, setFg] = useState('#1a1a1d')
  const [bg, setBg] = useState('#ffffff')
  const [dotStyle, setDotStyle] = useState('round')
  const [cornerStyle, setCornerStyle] = useState('round')
  const [logo, setLogo] = useState('none')
  const [logoUri, setLogoUri] = useState('')

  // Ref to measure the sticky top wrapper height so col-left sticks correctly below it
  const appTopRef = useRef(null)

  useEffect(() => {
    const updateTopOffset = () => {
      if (appTopRef.current) {
        const h = appTopRef.current.getBoundingClientRect().height
        document.documentElement.style.setProperty('--col-sticky-top', `${h + 24}px`)
      }
    }
    updateTopOffset()
    const ro = new ResizeObserver(updateTopOffset)
    if (appTopRef.current) ro.observe(appTopRef.current)
    return () => ro.disconnect()
  }, [])

  const qrData = tab === 'esewa'
    ? (esewaId || esewaName ? buildESEWAQR(esewaId, esewaName) : '')
    : (fpName || fpMerchantId ? buildEMVQR({ merchantId: fpMerchantId, name: fpName, city: fpCity, mcc: fpMcc }) : '')

  const displayName = tab === 'esewa' ? esewaName : fpName
  const tagLabel = tab === 'esewa' ? 'eSewa' : 'FonePay'
  const tagColor = tab === 'esewa' ? 'var(--esewa)' : 'var(--fone)'
  const tagBg = tab === 'esewa' ? 'var(--esewa-light)' : 'var(--fone-light)'
  const tagBorder = tab === 'esewa' ? 'var(--esewa-border)' : 'var(--fone-border)'
  const accentColor = tab === 'esewa' ? '#34c85a' : '#4f8ef7'

  const handleDownload = useCallback(() => {
    const canvas = document.querySelector('#qr-display-wrap canvas')
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `${tagLabel}-${displayName || 'qr'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [tagLabel, displayName])

  const handleQRDetected = useCallback((raw) => {
    const esewa = parseESEWAQR(raw)
    if (esewa) { setTab('esewa'); if (esewa.id) setEsewaId(esewa.id); if (esewa.name) setEsewaName(esewa.name); return }
    const emv = parseEMVQR(raw)
    if (emv) {
      setTab('fonepay')
      if (emv.name) setFpName(emv.name)
      if (emv.merchantId) setFpMerchantId(emv.merchantId)
      if (emv.city) setFpCity(emv.city)
      if (emv.mcc) setFpMcc(emv.mcc)
    }
  }, [])

  useEffect(() => {
    if (!window.jsQR) {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
      document.head.appendChild(s)
    }
  }, [])

  return (
    <div className="app">
      {/* Single sticky wrapper — banner + header + tabs scroll off as one unit */}
      <div className="app-top" ref={appTopRef}>
        <AndroidAppBanner />
        <header className="app-header">
          <PaisaWordmark />
          <div className="header-badge"><div className="badge-dot" />Nepal</div>
        </header>
        <nav className="tab-bar">
          <button className={`tab-btn${tab === 'esewa' ? ' tab-active tab-esewa' : ''}`} onClick={() => setTab('esewa')}>
            <Icon name={tab === 'esewa' ? 'wallet' : 'wallet-outline'} size={16} color={tab === 'esewa' ? 'var(--esewa)' : 'var(--text3)'} />
            eSewa
          </button>
          <button className={`tab-btn${tab === 'fonepay' ? ' tab-active tab-fone' : ''}`} onClick={() => setTab('fonepay')}>
            <Icon name={tab === 'fonepay' ? 'phone-portrait' : 'phone-portrait-outline'} size={16} color={tab === 'fonepay' ? 'var(--fone)' : 'var(--text3)'} />
            FonePay
          </button>
        </nav>
      </div>

      <main className="app-main">
        <div className="layout">
          <div className="col-left">
            <QRPreviewCard
              data={qrData} name={displayName}
              tagLabel={tagLabel} tagColor={tagColor} tagBg={tagBg} tagBorder={tagBorder}
              qrFg={fg} qrBg={bg} dotStyle={dotStyle} cornerStyle={cornerStyle}
              logo={logo} logoUri={logoUri} onDownload={handleDownload}
            />
          </div>
          <div className="col-right">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <h2 className="section-title">{tab === 'esewa' ? 'Account Details' : 'Merchant Details'}</h2>
                  <p className="section-sub">{tab === 'esewa' ? 'Your eSewa information' : 'From your FonePay dashboard'}</p>
                </div>
                <div className="scan-pill" style={{ background: accentColor + '18', borderColor: accentColor + '40', color: accentColor }}
                  onClick={() => document.querySelector('.upload-zone')?.click()}>
                  <Icon name="scan-outline" size={13} color={accentColor} /><span>Scan</span>
                </div>
              </div>
              <UploadDropZone onQRDetected={handleQRDetected} accentColor={accentColor} />
              {tab === 'esewa' ? (
                <>
                  <Field label="eSewa ID" iconName="call-outline" value={esewaId} onChange={setEsewaId} placeholder="98XXXXXXXX" type="tel" maxLength={15} accentColor={accentColor} />
                  <Field label="Display Name" iconName="person-outline" value={esewaName} onChange={setEsewaName} placeholder="Your full name" accentColor={accentColor} />
                </>
              ) : (
                <>
                  <div className="fonepay-notice" style={{ background: 'var(--fone-light)', borderColor: 'var(--fone-border)' }}>
                    <Icon name="information-circle-outline" size={15} color="var(--fone)" />
                    <span style={{ color: 'var(--fone)' }}>Some FonePay QRs are encrypted. Manual entry always works.</span>
                  </div>
                  <Field label="Merchant Name" iconName="storefront-outline" value={fpName} onChange={setFpName} placeholder="Your business name" accentColor={accentColor} />
                  <Field label="Merchant ID" iconName="barcode-outline" value={fpMerchantId} onChange={setFpMerchantId} placeholder="22220200027753" note="from dashboard" accentColor={accentColor} />
                  <div className="row-2">
                    <Field label="City" iconName="location-outline" value={fpCity} onChange={setFpCity} placeholder="Kathmandu" accentColor={accentColor} />
                    <Field label="MCC" iconName="grid-outline" value={fpMcc} onChange={setFpMcc} placeholder="8299" maxLength={4} accentColor={accentColor} />
                  </div>
                </>
              )}
            </section>
            <section className="section-card">
              <div className="section-header">
                <div>
                  <h2 className="section-title">Customize</h2>
                  <p className="section-sub">Style your QR code</p>
                </div>
                <div className="style-badge" style={{ background: 'var(--accent-light)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }}>
                  <Icon name="color-palette-outline" size={11} color="var(--accent)" />Style
                </div>
              </div>
              <StylePanel fg={fg} bg={bg} dotStyle={dotStyle} cornerStyle={cornerStyle}
                logo={logo} logoUri={logoUri}
                onFg={setFg} onBg={setBg} onDotStyle={setDotStyle} onCornerStyle={setCornerStyle}
                onLogo={setLogo} onLogoUri={setLogoUri} accentColor={accentColor} />
            </section>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <span>Made with ♥ in Nepal</span>
        <span className="footer-dot">·</span>
        <span>Paisa Studio © 2025</span>
      </footer>
    </div>
  )
}
