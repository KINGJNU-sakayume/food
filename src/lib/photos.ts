export async function compressPhoto(
  file: File,
): Promise<{ storage_path: string; width: number; height: number }> {
  if (!file.type.startsWith("image/"))
    throw new Error("이미지 파일을 선택해 주세요.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("사진은 장당 25MB 이하로 선택해 주세요.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "사진을 읽을 수 없습니다. JPEG, PNG 또는 WebP 파일을 선택해 주세요.",
    );
  }
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      width = Math.max(1, Math.round(bitmap.width * ratio)),
      height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 브라우저에서는 사진을 처리할 수 없습니다.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { storage_path: canvas.toDataURL("image/webp", 0.8), width, height };
  } finally {
    bitmap.close();
  }
}
