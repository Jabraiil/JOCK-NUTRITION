let cropRect = null
let targetWidth = 320
let mainCanvas = null
let mainCtx = null

self.onmessage = async (e) => {
  const { type, bitmap, crop, tw } = e.data

  if (type === 'init') {
    cropRect = crop
    targetWidth = tw || 320

    try {
      mainCanvas = new OffscreenCanvas(targetWidth, targetWidth)
      mainCtx = mainCanvas.getContext('2d')
    } catch (err) {
      self.postMessage({ type: 'init_error', error: 'Worker init failed' })
    }
    return
  }

  if (type === 'scan' && bitmap) {
    if (!mainCanvas || !mainCtx) {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close()
      self.postMessage({ type: 'error', error: 'Worker not initialized' })
      return
    }

    try {
      const { x = 0, y = 0, w = bitmap.width, h = bitmap.height } = cropRect || {}
      const cw = Math.max(1, w)
      const scale = targetWidth / cw
      const tw = targetWidth
      const th = Math.max(1, Math.round(h * scale))

      if (mainCanvas.width !== tw) mainCanvas.width = tw
      if (mainCanvas.height !== th) mainCanvas.height = th

      mainCtx.clearRect(0, 0, tw, th)
      mainCtx.drawImage(bitmap, x, y, w, h, 0, 0, tw, th)

      const croppedBitmap = await createImageBitmap(mainCanvas)
      self.postMessage({ type: 'result', bitmap: croppedBitmap }, [croppedBitmap])
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message })
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close()
      }
    }
  }
}