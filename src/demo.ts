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
    ctx.fillStyle = '#a5b7a1'; ctx.fillRect(0, 540, 1920, 540)
    ctx.fillStyle = '#d2c298'; ctx.fillRect(0, 650, 1920, 430)
    ctx.strokeStyle = '#b0a27d'; ctx.lineWidth = 3
    for (let x = 0; x <= 1920; x += 120) {
      ctx.beginPath(); ctx.moveTo(960 + (x - 960) * 0.25, 650); ctx.lineTo(x, 1080); ctx.stroke()
    }
    for (const y of [700, 770, 870, 1010]) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1920, y); ctx.stroke()
    }
    ctx.fillStyle = '#d2c298'; ctx.fillRect(0, 1075, 1920, 5)
  }
  return canvas
}
