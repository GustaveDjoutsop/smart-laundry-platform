export interface RevenueDataPoint {
  day: string;
  revenue: number;
}

export interface RevenueChartProps {
  data: RevenueDataPoint[];
  target?: number;
}
