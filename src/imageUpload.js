const MAX_SIDE = 1600
const QUALITY = 0.78

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}

export async function imageToDataUrl(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return readAsDataUrl(file)
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 300 * 1024) return readAsDataUrl(file)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!compressed || compressed.type !== 'image/webp' || compressed.size >= file.size) return readAsDataUrl(file)
    return readAsDataUrl(compressed)
  } catch {
    return readAsDataUrl(file)
  } finally {
    bitmap?.close()
  }
}
