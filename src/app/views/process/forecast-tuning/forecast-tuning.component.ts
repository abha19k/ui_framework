import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent,
  ColComponent, RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { firstValueFrom } from 'rxjs';
import Chart from 'chart.js/auto';

interface ISeriesPoint { StartDate: string; Qty: number; }
interface ISaved { id: number; name: string; query: string; created_at?: string; }
interface IKey { ProductID: string; ChannelID: string; LocationID: string; }

interface ITuneRow {
  lag: number;
  params: Record<string, any>;
  features: Record<string, any>;
  MAE: number; RMSE: number; MAPE: number; sMAPE: number; WAPE: number;
}
interface ITuneResult {
  tried: number;
  results?: ITuneRow[];
  best?: ITuneRow | null;
}

@Component({
  standalone: true,
  selector: 'app-forecast-tuning',
  templateUrl: './forecast-tuning.component.html',
  styleUrls: ['./forecast-tuning.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class ForecastTuningComponent implements OnInit, OnDestroy {
  private http: HttpClient = inject(HttpClient);
  private readonly API = 'http://127.0.0.1:8000/api';

  // ---------- Filters (single-key) ----------
  productIdCtrl = new FormControl<string>('');
  channelIdCtrl = new FormControl<string>('');
  locationIdCtrl = new FormControl<string>('');
  periodSelection = new FormControl<'Daily' | 'Weekly' | 'Monthly'>('Monthly');

  // ---------- Saved searches (query mode) ----------
  savedSearches: ISaved[] = [];
  savedSearchId = new FormControl<number | null>(null);
  queryCtrl = new FormControl<string>('');
  newSavedName = new FormControl<string>('');

  // ---------- Tuning ----------
  lagCtrl = new FormControl<number>(6);
  horizonCtrl = new FormControl<number>(18);
  foldsCtrl = new FormControl<number>(3);
  useCleansedCtrl = new FormControl<boolean>(false);

  xgbParamsForm = new FormGroup({
    n_estimators:        new FormControl<number | null>(400),
    learning_rate:       new FormControl<number | null>(0.05),
    max_depth:           new FormControl<number | null>(5),
    subsample:           new FormControl<number | null>(0.9),
    colsample_bytree:    new FormControl<number | null>(0.8),
    reg_lambda:          new FormControl<number | null>(1.0),
    reg_alpha:           new FormControl<number | null>(null),
    min_child_weight:    new FormControl<number | null>(null),
    gamma:               new FormControl<number | null>(null),
  });

  xgbFeaturesForm = new FormGroup({
    seasonal_lags:       new FormControl<string>('12,24'),
    rolling_windows:     new FormControl<string>('3,6'),
    use_log1p:           new FormControl<boolean>(true),
    two_stage:           new FormControl<boolean>(false),
    zero_prob_threshold: new FormControl<number | null>(0.5),
  });

  // ---------- Options ----------
  productIds: string[] = [];
  channelIds: string[] = [];
  locationIds: string[] = [];

  // ---------- UI state ----------
  loading = false;
  errorMessage: string | null = null;
  metrics: Record<string, number> | null = null;
  tuneResult: ITuneResult | null = null;
  selectedModel: string | null = null;

  // ---------- Chart ----------
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  // ---------- Colors ----------
  private readonly COLORS = {
    history:       '#2563eb', // blue
    forecastKey:   '#10b981', // green
    forecastQuery: '#f59e0b', // amber
  };

  // === Default hyperparams / horizons per period ============================
  setDefaultsForPeriod(p: 'Daily' | 'Weekly' | 'Monthly') {
    if (p === 'Daily') {
      this.lagCtrl.setValue(14);
      this.horizonCtrl.setValue(7);   // next 7 days
      this.foldsCtrl.setValue(3);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '7,14,28',
        rolling_windows: '7,28',
        use_log1p: true,
        two_stage: false
      });
    } else if (p === 'Weekly') {
      this.lagCtrl.setValue(13);
      this.horizonCtrl.setValue(13);  // next 13 weeks
      this.foldsCtrl.setValue(3);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '52',
        rolling_windows: '4,13',
        use_log1p: true,
        two_stage: false
      });
    } else {
      this.lagCtrl.setValue(6);
      this.horizonCtrl.setValue(18);  // next 18 months
      this.foldsCtrl.setValue(3);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '12,24',
        rolling_windows: '3,6',
        use_log1p: true,
        two_stage: false
      });
    }
  }

  private hexA(hex: string, a = 0.15) {
    const h = hex.replace('#','');
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  async ngOnInit(): Promise<void> {
    await this.loadDropdownOptions();
    await this.loadSavedSearches();
  }
  ngOnDestroy(): void { this.destroyChart(); }

  private uniqSort(arr: string[]): string[] {
    return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b)));
  }

  private periodSlug(): 'daily'|'weekly'|'monthly' {
    return this.periodSelection.value === 'Weekly' ? 'weekly'
         : this.periodSelection.value === 'Monthly' ? 'monthly' : 'daily';
  }

  private buildQueryFromFilters(): string {
    const tokens: string[] = [];
    const p = (this.productIdCtrl.value || '').trim();
    const c = (this.channelIdCtrl.value || '').trim();
    const l = (this.locationIdCtrl.value || '').trim();
    if (p) tokens.push(`productid:${p}`);
    if (c) tokens.push(`channelid:${c}`);
    if (l) tokens.push(`locationid:${l}`);
    return tokens.join(' ');
  }

  private async loadDropdownOptions() {
    this.loading = true; this.errorMessage = null;
    try {
      const [prods, chans, locs] = await Promise.all([
        firstValueFrom(this.http.get<any[]>(`${this.API}/products`)),
        firstValueFrom(this.http.get<any[]>(`${this.API}/channels`)),
        firstValueFrom(this.http.get<any[]>(`${this.API}/locations`)),
      ]);
      this.productIds  = this.uniqSort((prods || []).map(p => String(p.ProductID ?? '')).filter(Boolean));
      this.channelIds  = this.uniqSort((chans || []).map(c => String(c.ChannelID ?? '')).filter(Boolean));
      this.locationIds = this.uniqSort((locs || []).map(l => String(l.LocationID ?? '')).filter(Boolean));
    } catch (err) {
      console.error(err);
      this.errorMessage = 'Failed to load dropdown options.';
    } finally { this.loading = false; }
  }

  private async loadSavedSearches() {
    try {
      const list = await firstValueFrom(this.http.get<ISaved[]>(`${this.API}/saved-searches`));
      this.savedSearches = list || [];
    } catch (e) {
      console.error(e);
    }
  }

  onSavedSearchChange() {
    const id = this.savedSearchId.value;
    const found = this.savedSearches.find(s => s.id === id!);
    this.queryCtrl.setValue(found?.query ?? '');
  }

  async saveCurrentAsSearch() {
    const name = (this.newSavedName.value || '').trim();
    if (!name) { this.errorMessage = 'Enter a name to save the search.'; return; }

    const q = (this.queryCtrl.value || '').trim() || this.buildQueryFromFilters();
    if (!q) { this.errorMessage = 'Nothing to save — set filters or enter a query.'; return; }

    this.loading = true; this.errorMessage = null;
    try {
      await firstValueFrom(this.http.post(`${this.API}/saved-searches`, { name, query: q }));
      this.newSavedName.setValue('');
      await this.loadSavedSearches();
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to save search.';
    } finally { this.loading = false; }
  }

  // ---------------- History (single-key/chart) — NO saved forecast overlay ----------------
  async updatePlot() {
    this.errorMessage = null;
    const q = this.buildQueryFromFilters();
    if (!q) {
      this.errorMessage = 'Select at least one of ProductID, ChannelID, or LocationID.';
      this.destroyChart();
      return;
    }

    const bucket = this.periodSlug();
    const params = new HttpParams().set('q', q).set('max_points', '800');

    this.loading = true;
    try {
      const hist = await firstValueFrom(
        this.http.get<ISeriesPoint[]>(`${this.API}/history/${bucket}-series-by-query`, { params })
      );
      if (!hist?.length) { this.errorMessage = 'No history for this selection.'; this.destroyChart(); return; }

      this.drawChart(
        hist.map(s => s.StartDate),      // full ISO, let ticks format it
        hist.map(s => s.Qty),
        'History (Key)',
        this.COLORS.history
      );
    } catch (err) {
      console.error(err);
      this.errorMessage = 'Failed to load history.';
      this.destroyChart();
    } finally { this.loading = false; }
  }

  // ---------------- History (query) — NO saved forecast overlay ----------------
  async loadHistoryForQuery() {
    this.errorMessage = null;
    const q = (this.queryCtrl.value || '').trim();
    if (!q) { this.errorMessage = 'This saved search has no query.'; return; }

    const bucket = this.periodSlug();
    const params = new HttpParams().set('q', q).set('max_points', '800');

    this.loading = true;
    try {
      const hist = await firstValueFrom(
        this.http.get<ISeriesPoint[]>(`${this.API}/history/${bucket}-series-by-query`, { params })
      );
      if (!hist?.length) { this.errorMessage = 'No history for this query.'; this.destroyChart(); return; }

      this.drawChart(
        hist.map(s => s.StartDate),
        hist.map(d => d.Qty),
        'History (Query)',
        this.COLORS.history
      );
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to load query history.';
      this.destroyChart();
    } finally { this.loading = false; }
  }

  // ---------------- Forecast (per key; daily/weekly/monthly) ----------------
  private requireKey(): IKey | null {
    const p = (this.productIdCtrl.value || '').trim();
    const c = (this.channelIdCtrl.value || '').trim();
    const l = (this.locationIdCtrl.value || '').trim();
    if (!p || !c || !l) {
      this.errorMessage = 'Pick ProductID, ChannelID and LocationID to run single-key ops.';
      return null;
    }
    return { ProductID: p, ChannelID: c, LocationID: l };
  }

  async runSingleKeyForecast(save: boolean) {
    this.errorMessage = null;
    const k = this.requireKey(); if (!k) return;

    const period = this.periodSlug();
    const horizon = this.horizonCtrl.value ?? 18;
    const use_cleansed = this.useCleansedCtrl.value ?? false;

    this.loading = true;
    try {
      const body = { key: k, period, horizon, save, use_cleansed };
      const res: any = await firstValueFrom(
        this.http.post(`${this.API}/forecast/18m/run-by-key`, body)
      );
      this.selectedModel = res?.model ?? null;

      const preds = (res?.predictions || []) as Array<{ StartDate: string; Qty: number }>;
      if (!preds.length) { this.errorMessage = 'No forecast produced.'; return; }

      const labels = preds.map(p => p.StartDate); // full ISO
      const values = preds.map(p => p.Qty);

      if (!this.chart) this.drawChart(labels, [], '');
      this.addDatasetAlignedStyled(labels, values,
        'Forecast (Key)',
        {
          pointRadius: 2,
          borderColor: this.COLORS.forecastKey,
          backgroundColor: this.COLORS.forecastKey,
          pointBackgroundColor: this.COLORS.forecastKey,
        }
      );
    } catch (e: any) {
      console.error(e);
      this.errorMessage = e?.error?.detail || 'Failed to run forecast.';
    } finally { this.loading = false; }
  }


    // ---------------- Query aggregate forecast (optionally save) -------------
  async runForecastForQuery(save: boolean = false) {
  this.errorMessage = null;
  const q = (this.queryCtrl.value || '').trim();
  if (!q) { this.errorMessage = 'This saved search has no query.'; return; }

  const period = this.periodSlug();
  const horizon = this.horizonCtrl.value ?? 18;
  const max_keys = 500;
  const use_cleansed = this.useCleansedCtrl.value ?? false;

  this.loading = true;
  try {
    const res: any = await firstValueFrom(
      this.http.post(`${this.API}/forecast/18m/run-by-query`, {
        q,
        period,
        horizon,
        max_keys,
        use_cleansed,
        save, // 🔴 this is the important part
      })
    );

    const series = (res?.series || []) as ISeriesPoint[];
    if (!series.length) {
      this.errorMessage = 'No forecast produced for this saved search.';
      return;
    }

    const labels = series.map(s => s.StartDate); // full ISO
    const values = series.map(s => s.Qty);

    if (!this.chart) this.drawChart(labels, [], '');
    this.addDatasetAlignedStyled(labels, values, 'Forecast (Query)', {
      pointRadius: 2,
      borderColor: this.COLORS.forecastQuery,
      backgroundColor: this.COLORS.forecastQuery,
      pointBackgroundColor: this.COLORS.forecastQuery,
    });

    // Optional: tiny UX improvement
    if (save) {
      // not a toast, but at least some confirmation
      this.errorMessage = null;
    }
  } catch (e: any) {
    console.error(e);
    this.errorMessage = e?.error?.detail || 'Failed to run forecast for this saved search.';
  } finally {
    this.loading = false;
  }
}
 
  

  // ---------------- Backtest / Tune placeholders ----------------
  async runBacktest() { this.errorMessage = 'Backtest via UI is not available with this runner.'; }
  async tuneXgb()   { this.errorMessage = 'XGB tuning UI is disabled with this runner.'; }

  // ---------------- Chart helpers ----------------
  private destroyChart() {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  private yTickFormat(this: any, tickValue: string | number): string {
    const n = Number(tickValue);
    if (!isFinite(n)) return String(tickValue);
    return n.toLocaleString();
  }

  private computeYScale(values: number[]) {
    const { min, max } = this.extent(values);
    return {
      type: 'linear' as const,
      beginAtZero: false,
      suggestedMin: min,
      suggestedMax: max,
      ticks: { callback: this.yTickFormat as any }
    };
  }

  private drawChart(labels: string[], values: number[], label = 'Qty', color?: string) {
    this.destroyChart();
    const ctx = this.chartCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;

    const lineColor = color ?? this.COLORS.history;
    const self = this;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: values.length ? [{
          label,
          data: values,
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          borderColor: lineColor,
          backgroundColor: this.hexA(lineColor, 0.15),
          pointBackgroundColor: lineColor,
          fill: true
        }] : []
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: { enabled: true }
        },
        scales: {
          x: {
            title: { display: true, text: 'Start Date' },
            ticks: {
              callback: (value, index) => {
                const raw = (self.chart?.data.labels?.[index] as string) || '';
                // Show YYYY-MM-DD for daily/weekly, YYYY-MM for monthly
                const isMonthly = self.periodSelection.value === 'Monthly';
                return raw.substring(0, isMonthly ? 7 : 10);
              }
            }
          },
          y: this.computeYScale(values)
        }
      }
    });
  }

  private extent(values: Array<number | null | undefined>) {
    const nums = (values || []).filter(v => typeof v === 'number' && isFinite(v)) as number[];
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 1;
    if (max === min) { return { min: Math.max(0, min - 1), max: max + 1 }; }
    const pad = 0.08 * (max - min);
    return { min: Math.max(0, min - pad), max: max + pad };
  }

  private yScaleFromAllDatasets(extra?: number[]) {
    const dsVals: number[] = [];
    if (this.chart?.data?.datasets?.length) {
      this.chart.data.datasets.forEach(ds => {
        (ds.data as any[] || []).forEach(v => { if (typeof v === 'number' && isFinite(v)) dsVals.push(v); });
      });
    }
    if (extra?.length) dsVals.push(...extra.filter(x => typeof x === 'number') as number[]);
    return this.computeYScale(dsVals);
  }

  private addDatasetAlignedStyled(
    newLabels: string[],
    newValues: number[],
    datasetLabel: string,
    style: Partial<Chart['data']['datasets'][number]> = {}
  ) {
    if (!this.chart) { this.drawChart(newLabels, newValues, datasetLabel); return; }

    const currentLabels = (this.chart.data.labels as string[]) || [];
    const mergedSet = new Set<string>([...currentLabels, ...newLabels]);
    const mergedLabels = Array.from(mergedSet).sort(); // ISO strings sort chronologically

    const mapTo = (labels: string[], values: number[], all: string[]) => {
      const idx = new Map(labels.map((l, i) => [l, i]));
      return all.map(l => {
        const i = idx.get(l);
        return i === undefined ? null : values[i];
      });
    };

    const remappedExisting = (this.chart.data.datasets || []).map(ds => {
      const dsVals = (ds.data as (number|null)[]) || [];
      return { ds, vals: mapTo(currentLabels, dsVals as number[], mergedLabels) };
    });
    const newVals = mapTo(newLabels, newValues, mergedLabels);

    this.chart.data.labels = mergedLabels;
    remappedExisting.forEach(({ ds, vals }) => ds.data = vals);
    this.chart.data.datasets.push({
      label: datasetLabel,
      data: newVals,
      borderWidth: 2,
      tension: 0.2,
      pointRadius: 0,
      ...style
    });

    const yScale = this.yScaleFromAllDatasets();
    (this.chart.options.scales as any).y = yScale;

    this.chart.update();
  }
}
