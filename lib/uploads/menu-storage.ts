import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

export const MENU_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const MENU_UPLOAD_DIRECTORY = path.resolve(process.cwd(), "public", "uploads", "menu");
const MENU_PATH_PATTERN = /^\/uploads\/menu\/[A-Za-z0-9_-]+\.webp$/;

export class MenuImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuImageError";
  }
}

export function isMenuImagePath(value: unknown): value is string {
  return typeof value === "string" && MENU_PATH_PATTERN.test(value);
}

function absolutePathForMenuImage(imagePath: string) {
  if (!isMenuImagePath(imagePath)) throw new MenuImageError("Invalid menu image path.");
  const candidate = path.resolve(process.cwd(), "public", `.${imagePath}`);
  if (candidate !== MENU_UPLOAD_DIRECTORY && !candidate.startsWith(`${MENU_UPLOAD_DIRECTORY}${path.sep}`)) {
    throw new MenuImageError("Invalid menu image path.");
  }
  return candidate;
}

export async function storeMenuImage(file: File) {
  if (!file || file.size <= 0 || file.size > MENU_UPLOAD_MAX_BYTES) {
    throw new MenuImageError("Ukuran gambar maksimal 5 MB.");
  }
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
    throw new MenuImageError("Gunakan gambar JPEG, PNG, atau WebP.");
  }
  const input = Buffer.from(await file.arrayBuffer());
  let output: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: 25_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width < 1 || metadata.height < 1) {
      throw new MenuImageError("File gambar tidak valid.");
    }
    output = await image.rotate().webp({ quality: 84, effort: 4 }).toBuffer();
  } catch (error) {
    if (error instanceof MenuImageError) throw error;
    throw new MenuImageError("File gambar tidak valid atau rusak.");
  }

  await mkdir(MENU_UPLOAD_DIRECTORY, { recursive: true });
  const imagePath = `/uploads/menu/${randomUUID()}.webp`;
  const absolutePath = absolutePathForMenuImage(imagePath);
  try {
    await writeFile(absolutePath, output, { flag: "wx", mode: 0o644 });
  } catch {
    throw new MenuImageError("Gambar belum dapat disimpan. Coba lagi.");
  }
  return { imagePath, absolutePath };
}

export async function removeMenuImage(imagePath: string | null | undefined) {
  if (!imagePath || !isMenuImagePath(imagePath)) return;
  try {
    await rm(absolutePathForMenuImage(imagePath), { force: true });
  } catch {
    // Cleanup is best effort. The database never receives an unsafe path.
  }
}
