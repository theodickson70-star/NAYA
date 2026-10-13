// Picha za simu ni kubwa: zinapunguzwa hadi upande mrefu = 1600px, JPEG (kawaida KB 200–400) kabla ya kupakiwa.
const MAX_BYTES = 3 * 1024 * 1024;

export async function preparePhoto(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error('PDF ni kubwa mno (mwisho MB 3). Piga picha ya nyaraka badala yake.');
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error('Chagua picha.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Picha hii haifunguki. Jaribu kupiga picha upya.');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Picha ni kubwa mno. Jaribu kupiga picha upya.');
}
