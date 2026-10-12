const INSERT_BATCH = 5000;

/** Chia mảng lớn thành nhiều lô để createMany không vượt giới hạn tham số của PostgreSQL. */
export function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += INSERT_BATCH) out.push(items.slice(i, i + INSERT_BATCH));
  return out;
}

export function minDate(a: string, b: string) {
  return a < b ? a : b;
}
