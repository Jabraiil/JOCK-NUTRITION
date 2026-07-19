let detector = null
let cropRect = null
let targetWidth = 480

self.onmessage = async (e) => {
  const { type, bitmap, crop, tw } = e.data

  if (type === 'init') {
    cropRect = crop
    targetWidth = tw || 480
    try {
      detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'qr_code']
      })
    } catch (err) {
      self.postMessage({ type: 'error', error: 'BarcodeDetector unavailable in worker' })
    }
    return
  }

  if (type === 'scan' && detector && bitmap) {
    try {
      const { x = 0, y = 0, w = bitmap.width, h = bitmap.height } = cropRect || {}
      const cw = Math.max(1, w)
      const scale = targetWidth / cw
      const tw = targetWidth
      const th = Math.max(1, Math.round(h * scale))

      const canvas = new OffscreenCanvas(tw, th)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, x, y, w, h, 0, 0, tw, th)

      const barcodes = await detector.detect(canvas)
      self.postMessage({ type: 'result', barcode: barcodes.length > 0 ? barcodes[0].rawValue : null })
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message })
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close()
      }
    }
  }
}