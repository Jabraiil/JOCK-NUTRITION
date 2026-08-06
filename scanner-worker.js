let detector = null
let cropRect = null
let targetWidth = 320
let canvas = null
let ctx = null

self.onmessage = async (e) => {
  const { type, bitmap, crop, tw } = e.data

  if (type === 'init') {
    cropRect = crop
    targetWidth = tw || 320
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
    let localCanvas = null
    let localCtx = null
    try {
      const { x = 0, y = 0, w = bitmap.width, h = bitmap.height } = cropRect || {}
      const cw = Math.max(1, w)
      const scale = targetWidth / cw
      const tw = targetWidth
      const th = Math.max(1, Math.round(h * scale))

      localCanvas = new OffscreenCanvas(tw, th)
      localCtx = localCanvas.getContext('2d')
      localCtx.drawImage(bitmap, x, y, w, h, 0, 0, tw, th)

      const barcodes = await detector.detect(localCanvas)
      self.postMessage({ type: 'result', barcode: barcodes.length > 0 ? barcodes[0].rawValue : null })
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message })
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close()
      }
      if (localCtx) {
        localCtx.clearRect(0, 0, localCanvas.width, localCanvas.height)
      }
      localCanvas = null
      localCtx = null
    }
  }
}