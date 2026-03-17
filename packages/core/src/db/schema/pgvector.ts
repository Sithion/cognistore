import { customType } from 'drizzle-orm/pg-core';

export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 384})`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => parseFloat(v));
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});
