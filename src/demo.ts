/** Built-in diagrams make projection testable before real artwork is loaded. */
export function demoImage(kind: 'back' | 'front' | 'ground'): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1920
  canvas.height = 1080
  const ctx = canvas.getContext('2d')!
  if (kind === 'back') {
    const gradient = ctx.createLinearGradient(0, 0, 0, 1080)
    gradient.addColorStop(0, '#233c56')
    gradient.addColorStop(1, '#a6c9c1')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1920, 1080)
    ctx.fillStyle = '#f5db9d'
    ctx.beginPath(); ctx.arc(1390, 260, 112, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#547f80'
    ctx.beginPath(); ctx.moveTo(0, 720); ctx.lineTo(370, 390); ctx.lineTo(760, 730)
    ctx.lineTo(1100, 480); ctx.lineTo(1580, 750); ctx.lineTo(1920, 540)
    ctx.lineTo(1920, 1080); ctx.lineTo(0, 1080); ctx.fill()
    ctx.font = '32px sans-serif'; ctx.fillStyle = '#eff7ef'
    ctx.fillText('TOP / 共通キャンバス 1920 × 1080', 60, 75)
    ctx.fillText('L', 30, 550); ctx.fillText('R', 1850, 550)
  } else if (kind === 'front') {
    ctx.fillStyle = '#edb76d'
    ctx.fillRect(460, 460, 200, 430)
    ctx.fillStyle = '#223b43'
    ctx.fillRect(500, 510, 55, 130); ctx.fillRect(575, 510, 55, 130)
    ctx.fillRect(540, 720, 70, 170)
    ctx.fillStyle = '#d98f63'
    ctx.beginPath(); ctx.moveTo(410, 460); ctx.lineTo(560, 320); ctx.lineTo(710, 460); ctx.fill()
    ctx.fillStyle = '#203c3c'
    ctx.fillRect(1450, 600, 30, 330)
    ctx.fillStyle = '#38766b'
    ctx.beginPath(); ctx.moveTo(1465, 380); ctx.lineTo(1300, 760); ctx.lineTo(1630, 760); ctx.fill()
  } else {
    // The image starts at the projected back edge of the finite initial ground.
    // Keep the source a 2D image; it must not change to follow later 3D edits.
    const { cameraZ } = referenceMetrics(defaultSettings)
    const ground = defaultGroundTransform
    const backZ = ground.z - ground.height / 2
    const halfViewHeight = (cameraZ - backZ) * Math.tan(defaultSettings.fov * Math.PI / 360)
    const top = (0.5 - ground.y / (2 * halfViewHeight)) * canvas.height
    ctx.fillStyle = '#d2c298'
    ctx.fillRect(0, top, canvas.width, canvas.height - top)
  }
  return canvas
}
import { defaultGroundTransform, defaultSettings, referenceMetrics } from './model'

