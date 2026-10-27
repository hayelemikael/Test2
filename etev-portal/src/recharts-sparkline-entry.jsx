import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  YAxis
} from 'recharts';

const roots = new WeakMap();

function SparklineTooltip({ active, payload, unit = 'ETB', accentText = 'text-emerald-400' }) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  const val = Math.round(Number(item.val || 0)).toLocaleString();
  const dateStr = String(item.date || '').slice(5);
  return (
    <div className="bg-slate-950/95 border border-slate-700 rounded-md px-2 py-1 text-[10px] leading-tight shadow-lg pointer-events-none">
      <div className="text-slate-400 font-mono">{dateStr}</div>
      <div className={`${accentText} font-bold font-mono`}>{val} {unit}</div>
      {item.extra ? <div className="text-slate-400 font-mono">{item.extra}</div> : null}
    </div>
  );
}

function KpiSparkline({ data, days, label = 'Trend', unit = 'ETB', stroke = '#10b981', fillStart = '#10b981', fillEnd = '#059669', gradId = 'kpiSparkGrad', badgeClass = 'text-emerald-400', accentText = 'text-emerald-400' }) {
  const safeData = Array.isArray(data) ? data : [];
  if (!safeData.length) return null;

  const firstVal = Number(safeData[0]?.val || 0);
  const lastVal = Number(safeData[safeData.length - 1]?.val || 0);
  const isUp = lastVal >= firstVal;
  const strokeColor = isUp ? stroke : '#f59e0b';

  return (
    <div className="mt-1.5 pt-1.5 border-t border-slate-800/80">
      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
        <span>{label} ({days || safeData.length}d)</span>
        <span className={`font-mono ${isUp ? badgeClass : 'text-amber-400'}`}>
          {isUp ? '▲' : '▼'} {Math.round(lastVal).toLocaleString()}{unit === 'ETB' || unit === 'KM' ? ' ' + unit : ''}
        </span>
      </div>
      <div style={{ width: '100%', height: 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={safeData} margin={{ top: 3, right: 2, left: 2, bottom: 1 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={fillStart} stopOpacity={0.42} />
                <stop offset="95%" stopColor={fillEnd} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Tooltip
              content={<SparklineTooltip unit={unit} accentText={accentText} />}
              cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '2 2' }}
            />
            <Area
              type="monotone"
              dataKey="val"
              stroke={strokeColor}
              strokeWidth={1.75}
              fillOpacity={1}
              fill={`url(#${gradId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 3, fill: strokeColor, stroke: '#020617', strokeWidth: 1.5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

window.renderKpiSparkline = function renderKpiSparkline(containerEl, dailyRows, opts = {}) {
  if (!containerEl) return;
  try {
    const {
      dataKey = 'faresCollected',
      days = 7,
      label = 'Trend',
      unit = 'ETB',
      stroke = '#10b981',
      fillStart = stroke,
      fillEnd = stroke,
      gradId = 'sparkGrad_' + dataKey,
      badgeClass = 'text-emerald-400',
      accentText = 'text-emerald-400'
    } = opts;

    const normalized = (Array.isArray(dailyRows) ? dailyRows : []).map(d => {
      const cash = Number(d.cashDeposited || 0);
      const tele = Number(d.telebirr || 0);
      let rawVal = d[dataKey];
      if (dataKey === 'faresCollected' && rawVal == null) rawVal = cash + tele;
      return {
        date: d.date || '',
        val: Number(rawVal || 0),
        extra: dataKey === 'faresCollected' && (cash > 0 || tele > 0)
          ? `💵 ${Math.round(cash).toLocaleString()} · 📱 ${Math.round(tele).toLocaleString()}`
          : ''
      };
    });

    let root = roots.get(containerEl);
    if (!root) {
      root = createRoot(containerEl);
      roots.set(containerEl, root);
    }
    root.render(
      <KpiSparkline
        data={normalized}
        days={days}
        label={label}
        unit={unit}
        stroke={stroke}
        fillStart={fillStart}
        fillEnd={fillEnd}
        gradId={gradId}
        badgeClass={badgeClass}
        accentText={accentText}
      />
    );
  } catch (err) {
    console.warn('Recharts KPI sparkline render error:', err);
  }
};

window.renderFaresKpiSparkline = function renderFaresKpiSparkline(containerEl, dailyRows, days) {
  return window.renderKpiSparkline(containerEl, dailyRows, {
    dataKey: 'faresCollected',
    days,
    label: 'Trend',
    unit: 'ETB',
    stroke: '#10b981',
    fillStart: '#10b981',
    fillEnd: '#059669',
    gradId: 'faresSparkGrad',
    badgeClass: 'text-emerald-400',
    accentText: 'text-emerald-400'
  });
};
