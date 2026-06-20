'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { styles, chartColors, tooltipStyles } from './styles';
import type { RevenueChartProps } from './types';

export default function RevenueChart({ data, target }: RevenueChartProps) {
  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const progress = target ? (totalRevenue / target) * 100 : 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Revenue This Week</h3>
        {target && (
          <span className={styles.targetText}>
            {formatCurrency(totalRevenue)} / {formatCurrency(target)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {target && (
        <div className={styles.progressWrapper}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className={styles.progressLabel}>{progress.toFixed(1)}% of weekly target</p>
        </div>
      )}

      {/* Chart */}
      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={chartColors.gradientStart}
                  stopOpacity={chartColors.gradientStartOpacity}
                />
                <stop
                  offset="95%"
                  stopColor={chartColors.gradientStart}
                  stopOpacity={chartColors.gradientEndOpacity}
                />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartColors.tick, fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartColors.tick, fontSize: 12 }}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip
              contentStyle={tooltipStyles}
              formatter={(value: number) => [formatCurrency(value), 'Revenue']}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={chartColors.stroke}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRevenue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Daily breakdown */}
      <div className={styles.dailyGrid}>
        {data.map((d) => (
          <div key={d.day} className={styles.dailyItem}>
            <p className={styles.dailyLabel}>{d.day}</p>
            <p className={styles.dailyValue}>{(d.revenue / 1000).toFixed(0)}K</p>
          </div>
        ))}
      </div>
    </div>
  );
}
