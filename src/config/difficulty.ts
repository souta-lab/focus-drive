/** Explicit endpoint-preserving reconstruction; not a recovered manufacturer table. */
export const RESPONSE_WINDOWS_MS: readonly number[] = [
  1000,978,956,933,911,889,867,844,822,800,778,756,733,711,689,667,644,622,600,
  590,580,570,560,550,540,530,520,510,500,490,480,470,460,450,440,430,420,410,
  400,390,380,370,360,350,340,330,320,310,300,290,280,270,260,250,
];
/** 22–87.67m/s (~79–315km/h), monotonic speed-only difficulty. All entries are inferred. */
export const ROAD_SPEEDS_MPS: readonly number[] = Array.from({ length: 200 }, (_, i) => Number((22 + i * 0.33).toFixed(2)));
